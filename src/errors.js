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

/** Kinds worth retrying: the setup is fine, the cloud is momentarily not. */
const TRANSIENT_KINDS = new Set(['unreachable']);

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
  if (/too many|too_many_requests|\b429\b|temporarily blocked/.test(lowered)) {
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
  return { kind, transient: TRANSIENT_KINDS.has(kind), text, message };
}
