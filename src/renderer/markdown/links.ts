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

/** Joins and normalises POSIX path segments; `..` above the start is kept for main to refuse. */
function normalise(path: string): string {
  const absolute = path.startsWith('/')
  const out: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop()
    else if (segment !== '..' || !absolute) out.push(segment)
  }
  return (absolute ? '/' : '') + out.join('/')
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
  if (SCHEME.test(value)) {
    try {
      const url = new URL(value)
      return url.protocol === 'https:' ? { kind: 'external', url: url.href } : { kind: 'none' }
    } catch {
      return { kind: 'none' }
    }
  }
  const path = decode(value.replace(/[?#].*$/, ''))
  if (path === '') return { kind: 'none' }
  const joined = path.startsWith('/') || baseDir === '' ? path : `${baseDir}/${path}`
  const normalised = normalise(joined)
  return normalised === '' || normalised === '/' ? { kind: 'none' } : { kind: 'file', path: normalised }
}
