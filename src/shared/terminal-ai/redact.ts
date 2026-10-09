// Redaction of what Terminal AI sends to the model (ADR-0058, point 5): every field of the context
// passes through redactSecrets() before the request text is built (src/shared/terminal-ai/context.ts).
//
// Replaced with REDACTED:
// - AWS access key ids (`AKIA…`, `ASIA…`);
// - GitHub tokens (`ghp_…`, `gho_…`, `ghu_…`, `ghs_…`, `ghr_…`, `github_pat_…`);
// - `sk-…` keys of key shape (Anthropic `sk-ant-…`, OpenAI), Stripe `sk_live_…`/`rk_live_…`, Google `AIza…`;
// - Slack tokens (`xoxb-…`, `xoxp-…`, …);
// - JWTs (`eyJ….….…`);
// - the credential after `Bearer`, `Authorization:`, and after `Basic` when it is base64-shaped;
// - the value of a variable whose name says it is a secret: `*TOKEN=` (npm's `:_authToken=` too),
//   `*_KEY=`, `*APIKEY=`, `*ACCESSKEY=`, `*SECRET*=`, `*PASSWORD*=`, `*PASSWD*=` (any case, also inside
//   `export …` and a query string);
// - the value of `--password`, `--token`, `--secret`, `--api-key` options;
// - the password of `curl -u user:pass`, `wget --user user:pass`, `http -a user:pass` and of `mysql -pSecret`;
// - the password of a `user:pass@` URL;
// - a PEM private key block.
//
// It errs on the side of hiding: a command that only looks like a secret loses a word, a secret that
// does not look like one still goes out. Environment variables are never part of the context at all.

export const REDACTED = '[redacted]'

/** A variable name whose value is a secret. */
function isSecretName(name: string): boolean {
  const upper = name.toUpperCase()
  return (
    upper.endsWith('TOKEN') ||
    upper.endsWith('_KEY') ||
    upper.endsWith('APIKEY') ||
    upper.endsWith('ACCESSKEY') ||
    upper.includes('SECRET') ||
    upper.includes('PASSWORD') ||
    upper.includes('PASSWD')
  )
}

// The characters a token is made of; a secret ends at anything else (a space, a quote, a slash).
const PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{20,}/g,
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}/g,
  /(?<![A-Za-z0-9_])[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g,
  /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/g,
  /(?<![A-Za-z0-9_-])xox[abposr]-[A-Za-z0-9-]{10,}/g,
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
]

/**
 * `sk-…` keys (Anthropic `sk-ant-…`, OpenAI `sk-proj-…`): a token of key shape — at least 16
 * characters after `sk-` and a digit among them — also after `/` or `.` (a key file's path, a URL).
 * The digit keeps a word such as `feature/sk-learn-upgrade-for-models`.
 */
const SK_KEY = /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g
/** `scheme://user:password@host` — the password goes. */
const URL_PASSWORD = /([A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/:@'"]+):([^\s/@'"]+)@/g
/** `Bearer <credential>`, as in an Authorization header. */
const BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi
/** `Basic <credential>` wherever it stands; isBase64Credential() decides whether the word is one. */
const BASIC = /\b(Basic)\s+([A-Za-z0-9+/]{8,}={0,2})(?![A-Za-z0-9+/=])/g
/** `Authorization: <scheme> <credential>` or `Authorization: <credential>` (`token …` of GitHub, `Digest …`). */
const AUTH_HEADER = /(\bauthorization\s*[:=]\s*(?:(?:basic|bearer|token|digest)\s+)?)("[^"]*"|[^\s'"]+)/gi
/** `NAME=value`, `NAME="value"`, `NAME='value'`; the name decides (isSecretName). npm's `:_authToken=` too. */
const ASSIGNMENT = /(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s'"&;|]+)/g
/** `--password value`, `--token=value` and the like. */
const SECRET_OPTION = /(--(?:password|passwd|token|secret|api-key|apikey)(?:=|\s+))("[^"]*"|'[^']*'|[^\s'"]+)/gi
/**
 * `curl -u user:password`, `wget --user user:password`, httpie's `http -a user:password`: the part
 * after the first colon goes. Only in the arguments of those commands, so `docker run -u 1000:1000`
 * or `sort -u a:b` keep theirs:
 * - the command word starts the line or follows a space, `;`, `&`, `|`, `(` (also `$(`), a quote or a
 *   backtick (`bash -c "curl …"`, `` `curl …` ``), and may carry a path (`/usr/bin/curl`, `./curl`);
 *   not `my-curl` or `https://x.io/curl`;
 * - between the command and the option: arguments up to a `;`, `&`, `|` or line end that ends the
 *   command; one inside quotes (`-H "Content-Type: a; b"`, `"https://x?a=1&b=2"`) does not.
 */
const USER_OPTION =
  /((?<![^\s;&|("'`])(?:[A-Za-z0-9_.~/-]*\/)?(?:curl|wget|https?)(?=\s)(?:"[^"\n]*"|'[^'\n]*'|[^\n;&|"'])*?\s(?:-u|--user|-a|--auth)(?:=|\s+))(["']?)([^\s:'"]+):([^\s'"]+)\2/g
/** `mysql -pSecret` (and mysqldump, mysqladmin, mariadb): the password glued to `-p`. */
const MYSQL_PASSWORD = /(\b(?:mysql|mysqldump|mysqladmin|mariadb|mariadb-dump)\b[^\n|;&]*?\s-p)([^\s'"]+)/g

/**
 * Whether the word after `Basic` is a credential: base64 with a digit, `+`, `/` or `=` in it, or base64
 * that decodes to printable `user:password`. `Basic configuration` and `Basic Requirements` are words.
 */
function isBase64Credential(word: string): boolean {
  if (/[0-9+/=]/.test(word)) return true
  if (word.length % 4 !== 0) return false
  try {
    const decoded = atob(word)
    return /^[\x20-\x7e]+$/.test(decoded) && decoded.includes(':')
  } catch {
    return false
  }
}

/** `text` with every secret this module recognises replaced by REDACTED. */
export function redactSecrets(text: string): string {
  let result = text
  for (const pattern of PATTERNS) result = result.replace(pattern, REDACTED)
  result = result.replace(SK_KEY, (match) => (/\d/.test(match) ? REDACTED : match))
  result = result.replace(URL_PASSWORD, (_match, head: string) => `${head}:${REDACTED}@`)
  result = result.replace(BEARER, (_match, word: string) => `${word} ${REDACTED}`)
  result = result.replace(BASIC, (match, word: string, credential: string) => (isBase64Credential(credential) ? `${word} ${REDACTED}` : match))
  result = result.replace(AUTH_HEADER, (_match, head: string) => `${head}${REDACTED}`)
  result = result.replace(ASSIGNMENT, (match, name: string) => (isSecretName(name) ? `${name}=${REDACTED}` : match))
  result = result.replace(SECRET_OPTION, (_match, option: string) => `${option}${REDACTED}`)
  result = result.replace(USER_OPTION, (_match, option: string, quote: string, user: string) => `${option}${quote}${user}:${REDACTED}${quote}`)
  result = result.replace(MYSQL_PASSWORD, (_match, head: string) => `${head}${REDACTED}`)
  return result
}
