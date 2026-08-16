// -----------------------------------------------------------------------------
// Connection status aggregation.
//
// The host API exposes ONE connection status per integration — a boolean and a
// message — while the integration may hold up to three Overkiz sessions. This
// module folds the per-account states into that single channel.
//
// Rule: green only when every configured account is connected. A partial outage
// that showed up green would go unnoticed for months, so it shows up red and the
// message names the account at fault.
// -----------------------------------------------------------------------------

import { describeAccount } from './config.js';

/**
 * @typedef {object} AccountStatus
 * @property {import('./config.js').AccountConfig} account
 * @property {boolean} connected
 * @property {boolean} complete Whether the slot holds enough to connect at all.
 * @property {'credentials'|'locked'|'unreachable'|'unknown'|null} kind
 * @property {{ en: string, fr: string } | null} message The rich message of
 *   `describeOverkizError`, kept for the single-account case.
 */

// Said BEFORE the account name, so they have to stay short. The rich sentences
// of errors.js do not fit once three of them are joined together.
const REASONS = {
  credentials: { en: 'credentials refused', fr: 'identifiants refusés' },
  locked: { en: 'account temporarily locked', fr: 'compte temporairement verrouillé' },
  unreachable: { en: 'Overkiz cloud unreachable', fr: 'cloud Overkiz injoignable' },
  unknown: { en: 'connection failed', fr: 'connexion échouée' },
  incomplete: { en: 'email or password missing', fr: 'email ou mot de passe manquant' },
  disconnected: { en: 'disconnected, reconnecting', fr: 'déconnecté, reconnexion' },
};

// Kept verbatim from the single-account versions: the wording a user with one
// account sees must not change just because the integration learned to hold
// three.
const NO_ACCOUNT = {
  en: 'Please fill in your Overkiz server and credentials in the Configuration tab.',
  fr: "Veuillez renseigner votre serveur et vos identifiants Overkiz dans l'onglet Configuration.",
};

// A link that dropped after a successful connection carries no error to
// describe, so the single-account shortcut below needs a sentence of its own.
const DISCONNECTED = {
  en: 'Disconnected from the Overkiz API, reconnecting...',
  fr: "Déconnecté de l'API Overkiz, reconnexion...",
};

function reasonFor(status) {
  if (!status.complete) {
    return REASONS.incomplete;
  }
  if (status.kind) {
    return REASONS[status.kind] ?? REASONS.unknown;
  }
  return REASONS.disconnected;
}

/**
 * Fold the per-account statuses into the single status the host API accepts.
 *
 * @param {AccountStatus[]} statuses
 * @returns {{ connected: boolean, message?: { en: string, fr: string } }}
 */
export function buildConnectionStatus(statuses) {
  if (statuses.length === 0) {
    return { connected: false, message: NO_ACCOUNT };
  }

  const failing = statuses.filter((status) => !status.connected);
  if (failing.length === 0) {
    return { connected: true };
  }

  // A single account carries no ambiguity about WHICH account failed, so it
  // keeps the full sentences earlier versions showed — the rich one from
  // errors.js when it failed to connect, this one when the link merely dropped.
  if (statuses.length === 1 && failing[0].complete) {
    return { connected: false, message: failing[0].message ?? DISCONNECTED };
  }

  const describe = (lang) =>
    failing
      .map((status) => {
        const separator = lang === 'fr' ? ' : ' : ': ';
        return `${describeAccount(status.account, lang)}${separator}${reasonFor(status)[lang]}`;
      })
      .join(' · ');

  return { connected: false, message: { en: describe('en'), fr: describe('fr') } };
}
