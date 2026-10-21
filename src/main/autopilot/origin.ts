// The origin of a Project's repository as the key of an Autopilot run (worfy-link ticket 15,
// ADR-0053, Q13): one Epic of one repository runs under one Autopilot across the Linked machines.
// A repository on two Machines is two Projects (Q9), so the run is keyed by the Epic and the
// address of remote `origin`, not by the Project.
//
// The address is normalized so that the forms git takes for one repository give one key: the
// scheme, the user and the port go, the case is lowered, and a trailing `.git` and `/` go.
// `git@github.com:owner/repo.git`, `ssh://git@github.com/owner/repo.git` and
// `https://github.com/owner/repo` are all `github.com/owner/repo`.
//
// A Project without an origin — a root that is not in a git repository (a Silent mode Project over
// several repositories) or a repository without remote `origin` — has no key, and its start asks no
// one (decided without the owner, question 3 of the ticket).
import { execFile } from 'node:child_process'

/** The key of a remote URL as git takes it (see the top of the file); null for an empty one. */
export function originKey(url: string): string | null {
  let rest = url.trim().toLowerCase()
  if (rest === '') return null
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//.exec(rest)
  let host: string
  let path: string
  if (scheme !== null) {
    rest = rest.slice(scheme[0].length)
    const slash = rest.indexOf('/')
    host = slash === -1 ? rest : rest.slice(0, slash)
    path = slash === -1 ? '' : rest.slice(slash + 1)
  } else {
    // The scp-like form `[user@]host:path`; a local path has no host.
    const scp = /^([^/:]+):(.*)$/.exec(rest)
    if (scp === null) {
      host = ''
      path = rest
    } else {
      host = scp[1]!
      path = scp[2]!
    }
  }
  // The user and the port are not the repository.
  host = host.slice(host.lastIndexOf('@') + 1).replace(/:\d*$/, '')
  path = path
    .split('/')
    .filter((part) => part !== '')
    .join('/')
    .replace(/\.git$/, '')
  const key = [host, path].filter((part) => part !== '').join('/')
  return key === '' ? null : key
}

/** Runs git in `cwd`; answers its trimmed output, or null when it fails. */
function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((done) => {
    execFile('git', args, { cwd, encoding: 'utf8', timeout: 5000 }, (error, stdout) => done(error ? null : stdout.trim()))
  })
}

/**
 * The key of the remote `origin` of the repository at `root` (originKey); null when `root` is not in
 * a git repository, the repository has no `origin`, or git cannot be run. Never throws.
 */
export async function readOriginKey(root: string): Promise<string | null> {
  const url = await git(root, ['remote', 'get-url', 'origin'])
  return url === null ? null : originKey(url)
}

/**
 * What one run of git answered: its trimmed output, or how it failed — its exit code, null when it
 * did not exit by itself (the 5 s timeout, a signal, git missing) — and its stderr.
 */
export type GitRun = { ok: true; out: string } | { ok: false; code: number | null; stderr: string }

/** Runs git in `cwd` with its messages in English (LC_ALL=C), so a failure can be told by its text. */
export function runGit(cwd: string, args: string[]): Promise<GitRun> {
  return new Promise((done) => {
    execFile('git', args, { cwd, encoding: 'utf8', timeout: 5000, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => {
      if (error === null) done({ ok: true, out: stdout.trim() })
      else done({ ok: false, code: typeof error.code === 'number' ? error.code : null, stderr: String(stderr) })
    })
  })
}

/** `git remote get-url` exits 2 when the repository has no such remote. */
const NO_SUCH_REMOTE = 2

/**
 * Whether a remote URL names a host: `scheme://host/…` (not `file://`) or the scp-like `[user@]host:path`.
 * A local path — `/Users/x/repo.git`, `C:\repos\x.git`, `file:///srv/x.git` — names none: its key
 * would be a path of that Machine's disk.
 */
export function remoteHasHost(url: string): boolean {
  const rest = url.trim()
  const scheme = /^([a-z][a-z0-9+.-]*):\/\/([^/]*)/i.exec(rest)
  if (scheme !== null) return scheme[1]!.toLowerCase() !== 'file' && scheme[2]!.replace(/^.*@/, '').replace(/:\d*$/, '') !== ''
  // A Windows drive (`C:\…`, `C:/…`) is a local path, as git reads it.
  if (/^[a-z]:([\\/]|$)/i.test(rest)) return false
  const scp = /^([^/\\:]+):/.exec(rest)
  return scp !== null && scp[1]!.replace(/^.*@/, '') !== ''
}

/**
 * The key that tells one Project on two Machines (worfy-pipeline ticket 10, the owner's decision
 * Q14): the same repository, not the same path. With an origin it is the origin's key (originKey)
 * and the Project's path inside the repository, so `/Users/a/worfy` and `C:/src/worfy` of one
 * repository match; without one, the Project's id, which matches only on the Machine it was made
 * on. It carries no local path: a Project id is a folder name and a hash (projects/store.ts).
 */
export function projectMatchKey(project: { id: string; origin: string | null; repoPath: string | null }): string {
  return project.origin === null ? JSON.stringify(['id', project.id]) : JSON.stringify(['origin', project.origin, project.repoPath ?? ''])
}

/**
 * The match key of the Project with id `id` at `root` (projectMatchKey), read with git. The id key
 * is given only when git says there is no origin: `root` is not in a git repository (exit 128, "not
 * a git repository"), the repository has no remote `origin` (exit 2 of `get-url`), or the origin is
 * a local path (remoteHasHost; Q16). Any other failure — the timeout under load, a signal, another
 * exit code — rejects: a key read wrong would make another Machine show a note twice, or drop one.
 */
export async function readProjectMatchKey(root: string, id: string, run: (cwd: string, args: string[]) => Promise<GitRun> = runGit): Promise<string> {
  const [prefix, url] = await Promise.all([run(root, ['rev-parse', '--show-prefix']), run(root, ['remote', 'get-url', 'origin'])])
  const none = projectMatchKey({ id, origin: null, repoPath: null })
  if (!prefix.ok) {
    if (prefix.code === 128 && /not a git repository/i.test(prefix.stderr)) return none
    throw new Error(`git rev-parse failed (exit ${String(prefix.code)}): the match key of Project ${id} is unknown`)
  }
  if (!url.ok) {
    if (url.code === NO_SUCH_REMOTE) return none
    throw new Error(`git remote get-url origin failed (exit ${String(url.code)}): the match key of Project ${id} is unknown`)
  }
  // git prints the prefix through `/` on every platform.
  const repoPath = prefix.out.replace(/^\/+|\/+$/g, '')
  return projectMatchKey({ id, origin: remoteHasHost(url.out) ? originKey(url.out) : null, repoPath })
}
