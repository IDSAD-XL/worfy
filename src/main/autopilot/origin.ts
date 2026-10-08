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
