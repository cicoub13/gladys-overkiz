// -----------------------------------------------------------------------------
// Overkiz error classification.
//
// `overkiz-client` rejects with a plain STRING, not an Error (see its
// `ApiClient.request`: `throw msg`), so `err.message` is undefined and every
// failure would otherwise collapse into one generic message. This module turns
// whatever comes back into a cause the user can act on, and tells the caller
// whether retrying makes any sense.
// -----------------------------------------------------------------------------

/**
 * @typedef {'credentials' | 'locked' | 'unreachable' | 'unknown'} ErrorKind
 */

/**
 * Kinds NOT worth retrying regardless of what the HTTP status says: refused
 * credentials do not become valid by retrying, and a locked account only
 * gets locked harder.
 */
const FATAL_KINDS = new Set(['credentials', 'locked']);

/**
 * `ApiClient.request` formats its message as `Error <status> ...`; a raw
 * axios error (the OAuth token exchange lets one through unwrapped) reads
 * `... status code <n>`.
 */
function httpStatus(text) {
  const match = /\berror (\d{3})\b/i.exec(text) ?? /status code (\d{3})\b/i.exec(text);
  return match ? Number(match[1]) : null;
}

/**
 * Whether retrying is worth it. The HTTP status is the reliable signal, not
 * the regex-named kind: a 4xx means the server understood the request and
 * refused it, so retrying cannot help — and every retry here recreates the
 * Overkiz client (see `overkiz.js#start`), which resets `overkiz-client`'s
 * own anti-lockout backoff back to its floor. No status at all means the
 * request never reached the server (DNS, TCP, TLS...), which is worth
 * retrying: a whitelist by regex can never name every such failure, so an
 * unrecognized one (ENETUNREACH, a TLS error...) must default to "retry",
 * not to "give up silently".
 */
function isTransient(kind, text) {
  if (FATAL_KINDS.has(kind)) {
    return false;
  }
  const status = httpStatus(text);
  return status === null || status >= 500;
}

/**
 * Flatten a thrown value (string, Error, anything) into readable text.
 */
export function errorToText(err) {
  if (typeof err === 'string') {
    return err;
  }
  if (err instanceof Error) {
    return err.message;
  }
  if (err && typeof err === 'object' && typeof err.message === 'string') {
    return err.message;
  }
  return String(err);
}

function classify(text) {
  const lowered = text.toLowerCase();
  if (
    /too many|too_many_requests|\b429\b|temporarily blocked|api client locked|unbanned/.test(
      lowered,
    )
  ) {
    return 'locked';
  }
  if (/\b401\b|\b403\b|authentication_error|bad credentials|invalid credentials/.test(lowered)) {
    return 'credentials';
  }
  if (
    /enotfound|etimedout|econnrefused|econnreset|eai_again|socket hang up|network|timeout|\b5\d\d\b/.test(
      lowered,
    )
  ) {
    return 'unreachable';
  }
  return 'unknown';
}

const MESSAGES = {
  credentials: {
    en: 'Overkiz refused the credentials: check the email, the password and the selected server.',
    fr: "Overkiz a refusé les identifiants : vérifiez l'email, le mot de passe et le serveur sélectionné.",
  },
  locked: {
    en: 'Too many attempts: the Overkiz account is temporarily locked. Wait a few minutes before retrying.',
    fr: 'Trop de tentatives : le compte Overkiz est temporairement verrouillé. Attendez quelques minutes avant de réessayer.',
  },
  unreachable: {
    en: 'The Overkiz cloud is unreachable. Retrying automatically.',
    fr: 'Le cloud Overkiz est injoignable. Nouvelle tentative automatique.',
  },
};

/**
 * Describe an error thrown by the Overkiz client.
 *
 * @param {unknown} err
 * @returns {{ kind: ErrorKind, transient: boolean, text: string, message: { en: string, fr: string } }}
 */
export function describeOverkizError(err) {
  const text = errorToText(err);
  const kind = classify(text);
  // Unknown causes keep the raw text: a message the user can paste into an
  // issue beats a reassuring but useless generic sentence.
  const message = MESSAGES[kind] ?? {
    en: `Connection to the Overkiz API failed: ${text}`,
    fr: `La connexion à l'API Overkiz a échoué : ${text}`,
  };
  return { kind, transient: isTransient(kind, text), text, message };
}
