// The build version of worfy and of the Harness copy it carries: `<semver>+<short SHA>`, with
// `.dirty` at the end when the working tree has uncommitted changes (`git status --porcelain` is
// not empty, as scripts/install-stable.mjs counts them): such a build does not match its commit.
// semver allows dots in build metadata. electron.vite.config.ts writes it into
// out/harness/.claude-plugin/plugin.json; `app.version` answers it (src/main/harness/bundled.ts).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** What a build version looks like; anything else is a broken build, not a version. */
export const BUILD_VERSION = /^\d+\.\d+\.\d+\+[0-9a-f]{7,}(\.dirty)?$/

/** `<semver>+<sha>[.dirty]`, checked against BUILD_VERSION. */
export function formatBuildVersion(semver: string, sha: string, dirty: boolean): string {
  const version = `${semver}+${sha}${dirty ? '.dirty' : ''}`
  if (!BUILD_VERSION.test(version)) {
    throw new Error(`build version: "${version}" is not <major.minor.patch>+<short SHA>[.dirty]`)
  }
  return version
}

/**
 * The build version of the checkout at `root`: the package.json `version`, the short SHA of HEAD
 * and `.dirty` for uncommitted changes. Outside a git checkout it throws: a version without a SHA
 * cannot tell one build from another.
 */
export function buildVersion(root: string): string {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown }
  if (typeof version !== 'string') throw new Error(`build version: ${join(root, 'package.json')} has no "version"`)
  // GIT_DIR and friends set by a git hook would point git at another repository than `root`.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  let sha: string
  try {
    sha = git('rev-parse', '--short', 'HEAD')
  } catch (error) {
    const detail = (error as { stderr?: string }).stderr?.trim() || (error as Error).message
    throw new Error(`build version: ${root} is not a git checkout with a commit, and a build without a commit SHA cannot be told apart from another (${detail})`, { cause: error })
  }
  return formatBuildVersion(version, sha, git('status', '--porcelain') !== '')
}

/**
 * The build number of the checkout at `root` (worfy-update ticket 14): the number of commits from the
 * start of the history to HEAD, `git rev-list --count HEAD`, which grows with every commit of `main`
 * and is the same for one commit on every machine. The app shows it as `v<major>.<minor>.<N>`
 * (src/shared/version-number.ts); the build version above stays as it is. null when there is no
 * honest count: outside git, before the first commit, or in a shallow clone (CI's `fetch-depth`),
 * whose cut history would give a smaller number. A number is never guessed.
 */
export function buildNumber(root: string): number | null {
  // As in buildVersion: git is called right here, so the search of test/unit/e2e-no-spawn-on-load.test.ts sees it.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    if (git('rev-parse', '--is-shallow-repository') !== 'false') return null
    const count = Number(git('rev-list', '--count', 'HEAD'))
    return Number.isSafeInteger(count) && count > 0 ? count : null
  } catch {
    return null
  }
}
