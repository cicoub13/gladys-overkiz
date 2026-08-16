// -----------------------------------------------------------------------------
// State publishing.
//
// The host API rate-limits state updates to 300 per minute PER INTEGRATION —
// not per account. So this budget is held once for the whole integration and
// every account publishes through it; an account never touches `gladys` itself.
//
// Publishes are also serialized. Several Overkiz event pollers push changes
// independently, and two concurrent batches would each clear the budget check
// before either recorded its own consumption — overshooting the window, earning
// a 429, and turning into a resynchronization loop.
// -----------------------------------------------------------------------------

// The host API accepts at most 100 states per request, and 300 states per
// minute per integration.
const STATES_PER_REQUEST = 100;
const STATES_PER_WINDOW = 300;
const RATE_WINDOW_MS = 60_000;
// How long to wait before replaying the states a failed publish left behind.
const RESYNC_DELAY_MS = 60_000;

/**
 * @param {object} deps
 * @param {() => Promise<void>} deps.resync Replays every known state, called
 *   after a failed publish.
 */
export function createPublisher({ gladys, logger, scheduleTimer, now, sleep, resync }) {
  // feature external_id -> last value KNOWN TO BE PUBLISHED (only publish real
  // changes: the host API rate-limits state updates to 300 per minute).
  const lastValues = new Map();
  // Sliding window of accepted publishes: { at, count }.
  let recentPublishes = [];
  let cancelResync = null;
  let queue = Promise.resolve();

  /**
   * Hold back until `count` more states fit in the 300-per-minute window.
   * A first scan on a large setup easily exceeds it, and a 429 would cost more
   * than the wait.
   */
  async function waitForPublishBudget(count) {
    for (;;) {
      const cutoff = now() - RATE_WINDOW_MS;
      recentPublishes = recentPublishes.filter((entry) => entry.at > cutoff);
      const used = recentPublishes.reduce((total, entry) => total + entry.count, 0);
      if (used + count <= STATES_PER_WINDOW || recentPublishes.length === 0) {
        return;
      }
      const waitMs = Math.max(0, recentPublishes[0].at + RATE_WINDOW_MS - now());
      logger.warn(`State rate limit reached, pausing ${Math.ceil(waitMs / 1000)}s`);
      await sleep(waitMs);
    }
  }

  function scheduleResync() {
    if (cancelResync) {
      return; // one pending resynchronization is enough
    }
    cancelResync = scheduleTimer(() => {
      cancelResync = null;
      // `lastValues` was left untouched for whatever failed, so this republishes
      // exactly the values that were lost. The promise is returned so tests can
      // await the replay; the real timer ignores it.
      return resync().catch((err) => logger.error('State resynchronization failed', err));
    }, RESYNC_DELAY_MS);
  }

  /**
   * Publish a batch of changes, then — and only then — remember them.
   *
   * Recording a value before it is actually accepted would lose it for good:
   * the deduplication would consider it already published and skip it until the
   * device happens to change again, which for a smoke or leak sensor can be
   * months.
   */
  async function publishNow(states) {
    // Two accounts sharing one physical hub would describe the same feature
    // twice in a batch; the host API would take the first, we want the freshest.
    const deduplicated = [
      ...new Map(states.map((s) => [s.device_feature_external_id, s])).values(),
    ];
    for (let i = 0; i < deduplicated.length; i += STATES_PER_REQUEST) {
      const chunk = deduplicated.slice(i, i + STATES_PER_REQUEST);
      await waitForPublishBudget(chunk.length);
      try {
        await gladys.publishStates(chunk);
      } catch (err) {
        // Back off rather than hammer a rate-limited or restarting host.
        logger.error(`Failed to publish ${chunk.length} state(s), will resynchronize`, err);
        scheduleResync();
        return;
      }
      recentPublishes.push({ at: now(), count: chunk.length });
      for (const state of chunk) {
        lastValues.set(state.device_feature_external_id, state.state);
      }
    }
  }

  return {
    /** Queue a batch behind the ones already in flight. */
    publish(states) {
      const next = queue.then(
        () => publishNow(states),
        () => publishNow(states),
      );
      // A rejection must not poison the chain for the batches behind it.
      queue = next.catch(() => {});
      return next;
    },

    lastValue(featureExternalId) {
      return lastValues.get(featureExternalId);
    },

    /**
     * Forget what is known to have been published for these features, so the
     * next diff republishes them.
     */
    forget(featureExternalIds) {
      for (const id of featureExternalIds) {
        lastValues.delete(id);
      }
    },

    cancelResync() {
      cancelResync?.();
      cancelResync = null;
    },
  };
}
