// What a link in rendered markdown leads to. worfy opens exactly two kinds: an https:// address
// in the default browser, and a file of the Project in the app macOS assigns to it. Everything
// else (http://, javascript:, mailto:, protocol-relative //host, in-page #anchors) is shown as
// text and opens nothing.

export type LinkTarget =
  | { kind: 'external'; url: string }
  /** Relative to the Project root, or absolute; main refuses a path outside the Project. */
  | { kind: 'file'; path: string }
  | { kind: 'none' }

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
/** `C:\…`, `C:/…` or `\\server\share…`: a Windows path, not a `c:` scheme (worfy-windows ticket 08). */
const WINDOWS_ROOT = /^([A-Za-z]):[\\/]|^\\\\([^\\/]+)[\\/]([^\\/]+)/
const TWO_SEPARATORS = /^[\\/]{2}/

/**
 * Joins and normalises path segments; `..` above the start is kept for main to refuse. A relative
 * path takes `\` as a separator too; an absolute POSIX path only `/`.
 */
function normalise(path: string): string {
  const absolute = path.startsWith('/')
  const out: string[] = []
  for (const segment of path.split(absolute ? '/' : /[\\/]/)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop()
    else if (segment !== '..' || !absolute) out.push(segment)
  }
  return (absolute ? '/' : '') + out.join('/')
}

/**
 * Whether `href` is an absolute Windows path (`C:\…`, `C:/…`, `\\server\share…`). react-markdown's
 * default urlTransform blanks it as an unknown `c:` scheme; Markdown.tsx lets these through, and
 * only these, so classifyLink sees them. The markdown parser hands `\` over percent-encoded
 * (`C:%5CUsers`), so the address is decoded first.
 */
export function isWindowsPathLink(href: string): boolean {
  return WINDOWS_ROOT.test(decode(href.trim()))
}

/**
 * An absolute Windows path normalised (`\`, the drive letter in upper case); '' for a UNC or device
 * path (`\\host\share`, `\\?\`, `\\.\`), which opens nothing: following it would make Windows contact
 * that host with the user's credentials, and a link in a Ticket or a transcript can name any host
 * (review of worfy-windows ticket 08). main refuses a path outside the Project by its text too.
 */
function windowsPath(path: string): string | null {
  const root = WINDOWS_ROOT.exec(path)
  if (!root) return null
  if (root[1] === undefined) return ''
  const head = `${root[1].toUpperCase()}:`
  const out: string[] = []
  for (const segment of path.slice(root[0].length).split(/[\\/]/)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.length === 0 ? '' : `${head}\\${out.join('\\')}`
}

function decode(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/**
 * Classifies the `href` of a markdown link. `baseDir` is the directory of the document relative to
 * the Project root ('' for the root): a relative path is resolved against it, the way GitHub
 * resolves links in a file.
 */
export function classifyLink(href: string | undefined, baseDir = ''): LinkTarget {
  if (href === undefined) return { kind: 'none' }
  const value = href.trim()
  if (value === '' || value.startsWith('#') || value.startsWith('//')) return { kind: 'none' }
  if (isWindowsPathLink(value)) {
    const path = windowsPath(decode(value.replace(/[?#].*$/, '')))
    return path ? { kind: 'file', path } : { kind: 'none' }
  }
  if (SCHEME.test(value)) {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' ? { kind: 'external', url: url.href } : { kind: 'none' }
    } catch {
      return { kind: 'none' }
    }
  }
  const path = decode(value.replace(/[?#].*$/, ''))
  // `/\host\share` and `\/host/share`: Windows reads two leading separators of either kind as UNC,
  // as written or once `.` and `..` are resolved (`/./\host\share`).
  if (path === '' || TWO_SEPARATORS.test(path)) return { kind: 'none' }
  const joined = path.startsWith('/') || baseDir === '' ? path : `${baseDir}/${path}`
  const normalised = normalise(joined)
  return normalised === '' || normalised === '/' || TWO_SEPARATORS.test(normalised) ? { kind: 'none' } : { kind: 'file', path: normalised }
}
