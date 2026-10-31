// Where the GitHub links of the worfy Guide lead (worfy-guide ticket 03, ADR-0090): "Full page" and
// the files of Under the hood open the file on GitHub at the commit this build was made from, so the
// reader sees the code the Guide describes; when the build does not know its commit, at `main`.
// The commit comes from the build version `<semver>+<short SHA>[.dirty]` (scripts/build-version.ts),
// which main answers on `app.version`. A dirty build still names its commit: the closest one there is.
// They open in the system's browser (`shell.openExternal`), never in the window.
import { invoke } from '../ipc'

/** The public repository of worfy. */
export const GUIDE_REPO_URL = 'https://github.com/IDSAD-XL/worfy'

const COMMIT = /^[^+]+\+([0-9a-f]{7,40})(?:\.dirty)?$/

/** The commit SHA of a build version, or null when the version carries none. */
export function buildCommit(version: string | null | undefined): string | null {
  if (version == null) return null
  return COMMIT.exec(version)?.[1] ?? null
}

/** The GitHub address of a file of the repository at the build's commit, else at `main`. */
export function githubFileUrl(path: string, version: string | null | undefined): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `${GUIDE_REPO_URL}/blob/${buildCommit(version) ?? 'main'}/${encoded}`
}

/** Opens `url` in the system's browser; the window stays where it is. */
export function openInBrowser(url: string): void {
  void invoke('shell.openExternal', { url }).then((result) => {
    if (!result.ok) console.error('shell.openExternal failed:', result.error)
  })
}
