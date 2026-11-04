// The repository of a git remote URL: its host, owner and name (parseRemote), and the address of its page
// (repoPageUrl). No imports, nothing run: src/main/github/accounts.ts (the account step of connecting a Project),
// src/main/flight-recorder/github.ts (Run history) and src/main/workflow/reader.ts (the workflow model's
// repoUrl) share it, and the reader is loaded by e2e specs outside vite, where the terminal modules that
// accounts.ts brings cannot load (test/contract/reader-imports.test.ts).

/** A remote on a host: `owner/repo` there. */
export interface RemoteRepo {
  host: string
  owner: string
  repo: string
}

/**
 * The host, owner and repository of a remote URL — `https://host/owner/repo(.git)`,
 * `ssh://git@host(:port)/owner/repo`, `git@host:owner/repo` — or null for anything else (a path, a
 * nested group of another forge).
 */
export function parseRemote(url: string): RemoteRepo | null {
  const trimmed = url.trim()
  let host: string
  let path: string
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/u.exec(trimmed)
  if (/^[a-z+]+:\/\//iu.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(trimmed)
    } catch {
      return null
    }
    if (!['https:', 'http:', 'ssh:', 'git:', 'git+ssh:', 'ssh+git:'].includes(parsed.protocol)) return null
    host = parsed.hostname
    path = parsed.pathname
  } else if (scp !== null) {
    host = scp[1] ?? ''
    path = scp[2] ?? ''
  } else return null
  const parts = path
    .replace(/^\/+|\/+$/gu, '')
    .replace(/\.git$/u, '')
    .split('/')
  if (parts.length !== 2 || host === '' || parts.some((part) => part === '' || part === '.' || part === '..')) return null
  return { host: host.toLowerCase(), owner: parts[0] ?? '', repo: parts[1] ?? '' }
}

/**
 * The address of a repository's page from its remote URL (`git remote get-url origin` of the Project root,
 * the repository gh reads the PRs of): `https://<host>/<owner>/<repo>` for an https, ssh or scp-like remote
 * (`git@host:owner/repo.git`), without `.git`; null for a folder or any other form. The host is the
 * remote's own, so a GitHub Enterprise server gives its pages. The Run history screen opens
 * `<it>/pull/<N>` and `<it>/commit/<sha>` from it (worfy-flight-recorder ticket 19).
 */
export function repoPageUrl(remote: string): string | null {
  const repo = parseRemote(remote)
  if (repo === null) return null
  // Through a URL, never by concatenation: a credential left in the host (`a@token@host:owner/repo`) is
  // dropped, not handed to the browser and the tooltip.
  let page: URL
  try {
    page = new URL(`https://${repo.host}`)
  } catch {
    return null
  }
  page.username = ''
  page.password = ''
  page.port = ''
  page.pathname = `/${repo.owner}/${repo.repo}`
  return page.href
}
