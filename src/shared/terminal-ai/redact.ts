// Redaction of what Terminal AI sends to the model (ADR-0058, point 5): every field of the context
// passes through redactSecrets() before the request text is built (src/shared/terminal-ai/context.ts).
//
// Replaced with REDACTED:
// - AWS access key ids (`AKIA…`, `ASIA…`);
// - GitHub tokens (`ghp_…`, `gho_…`, `ghu_…`, `ghs_…`, `ghr_…`, `github_pat_…`);
// - `sk-…` keys (Anthropic `sk-ant-…`, OpenAI and the like);
// - Slack tokens (`xoxb-…`, `xoxp-…`, …);
// - JWTs (`eyJ….….…`);
// - the credential after `Bearer`;
// - the value of a variable whose name says it is a secret: `*_TOKEN=`, `*_KEY=`, `*SECRET*=`,
//   `*PASSWORD*=`, `*PASSWD*=` (any case, also inside `export …` and a query string);
// - the value of `--password`, `--token`, `--secret`, `--api-key` options;
// - the password of a `user:pass@` URL;
// - a PEM private key block.
//
// It errs on the side of hiding: a command that only looks like a secret loses a word, a secret that
// does not look like one still goes out. Environment variables are never part of the context at all.

export const REDACTED = '[redacted]'

/** A variable name whose value is a secret. */
function isSecretName(name: string): boolean {
  const upper = name.toUpperCase()
  return upper === 'TOKEN' || upper.endsWith('_TOKEN') || upper.endsWith('_KEY') || upper.includes('SECRET') || upper.includes('PASSWORD') || upper.includes('PASSWD')
}

// The characters a token is made of; a secret ends at anything else (a space, a quote, a slash).
const PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{20,}/g,
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}/g,
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}/g,
  /(?<![A-Za-z0-9_-])xox[abposr]-[A-Za-z0-9-]{10,}/g,
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
]

/** `scheme://user:password@host` — the password goes. */
const URL_PASSWORD = /([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/:@'"]+):([^\s/@'"]+)@/g
/** `Bearer <credential>`, as in an Authorization header. */
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi
/** `NAME=value`, `NAME="value"`, `NAME='value'`; the name decides (isSecretName). */
const ASSIGNMENT = /(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s'"&;|]+)/g
/** `--password value`, `--token=value` and the like. */
const SECRET_OPTION = /(--(?:password|passwd|token|secret|api-key|apikey)(?:=|\s+))("[^"]*"|'[^']*'|[^\s'"]+)/gi

/** `text` with every secret this module recognises replaced by REDACTED. */
export function redactSecrets(text: string): string {
  let result = text
  for (const pattern of PATTERNS) result = result.replace(pattern, REDACTED)
  result = result.replace(URL_PASSWORD, (_match, head: string) => `${head}:${REDACTED}@`)
  result = result.replace(BEARER, (_match, word: string) => `${word} ${REDACTED}`)
  result = result.replace(ASSIGNMENT, (match, name: string) => (isSecretName(name) ? `${name}=${REDACTED}` : match))
  result = result.replace(SECRET_OPTION, (_match, option: string) => `${option}${REDACTED}`)
  return result
}
