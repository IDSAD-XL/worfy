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
