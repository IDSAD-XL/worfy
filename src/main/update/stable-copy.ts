// Where the Stable copy lies and which commit it runs (worfy-update ticket 01, spec R1). The path is
// the one scripts/install-stable.mjs installs to when no target is given (defaultTarget): that
// script is not part of the app, so the rule is repeated here. The file next to the copy
// (metadataPath of the script) names the full commit it was built from.
//
// Update is on only in the packaged Stable copy: a packaged build elsewhere (`pnpm test:package`,
// the installer's folder, a copy in /tmp) is treated like a dev build, or worfy would replace a
// Stable copy that was not the one running. WORFY_UPDATE=1 turns it on anyway, for e2e, which runs
// the unpacked build; WORFY_UPDATE_STABLE puts the Stable copy somewhere else, for tests.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { z } from 'zod'

type Env = Readonly<Record<string, string | undefined>>

const APP = 'worfy'

const rulesOf = (platform: NodeJS.Platform): typeof posix => (platform === 'win32' ? win32 : posix)

/** The Stable copy: WORFY_UPDATE_STABLE, else the default target of scripts/install-stable.mjs. */
export function stableCopyPath(platform: NodeJS.Platform = process.platform, env: Env = process.env, home: string = homedir()): string {
  const rules = rulesOf(platform)
  const override = env.WORFY_UPDATE_STABLE
  if (override) return rules.resolve(override)
  if (platform === 'win32') return win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData', 'Local'), `${APP}-stable`)
  return posix.join(home, 'Applications', `${APP}-stable.app`)
}

/** The file next to the copy that names its commit (metadataPath of scripts/install-stable.mjs). */
export function stableMetadataPath(platform: NodeJS.Platform, copy: string): string {
  return platform === 'win32' ? `${copy}.json` : `${copy.replace(/\.app$/u, '')}.json`
}

/** `path` is `folder` or lies inside it; on Windows in any case of the letters. */
function inside(platform: NodeJS.Platform, folder: string, path: string): boolean {
  const rules = rulesOf(platform)
  const fold = (value: string): string => (platform === 'win32' ? value.toLowerCase() : value)
  const rel = rules.relative(fold(rules.resolve(folder)), fold(rules.resolve(path)))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${rules.sep}`) && !rules.isAbsolute(rel))
}

export interface UpdateEnabledInput {
  /** app.isPackaged */
  packaged: boolean
  /** process.execPath */
  execPath: string
  env: Env
  platform?: NodeJS.Platform
  home?: string
}

/** This run is the packaged Stable copy. */
export function runsFromStableCopy({ packaged, execPath, env, platform = process.platform, home = homedir() }: UpdateEnabledInput): boolean {
  return packaged && inside(platform, stableCopyPath(platform, env, home), execPath)
}

/** Whether this run checks for an Update: WORFY_UPDATE=1, or the packaged Stable copy. */
export function updateEnabled(input: UpdateEnabledInput): boolean {
  return input.env.WORFY_UPDATE === '1' || runsFromStableCopy(input)
}

const metadataSchema = z.object({ commit: z.string() }).loose()
const FULL_SHA = /^[0-9a-f]{40}$/u
const BUILD_SHA = /\+([0-9a-f]{7,40})(?:\.dirty)?$/u

/**
 * The commit the copy runs: `commit` of the file next to it, else the SHA of the build version.
 * An empty `commit` when neither names one: such a run cannot be compared with `main`.
 */
export function runningOf(metadata: { commit: string } | undefined, version: string): { commit: string; version: string } {
  if (metadata !== undefined && FULL_SHA.test(metadata.commit)) return { commit: metadata.commit, version }
  return { commit: BUILD_SHA.exec(version)?.[1] ?? '', version }
}

/** The file next to the copy, or undefined when it is missing or does not read. */
export function readStableMetadata(platform: NodeJS.Platform, copy: string): { commit: string } | undefined {
  try {
    const parsed = metadataSchema.safeParse(JSON.parse(readFileSync(stableMetadataPath(platform, copy), 'utf8')))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}
