// The Electron fuses of a packaged worfy in the @packaged tests (worfy-auto-approve ticket 12).
//
// electron-builder.yml turns RunAsNode and EnableNodeCliInspectArguments off in the packaged worfy.
// Playwright's _electron.launch cannot drive such a build: it always starts Electron with
// `--inspect=0` and waits for the line "Debugger listening on ws://…" of the Node inspector
// (playwright-core 1.63, lib/coreBundle.js:44247 and :44315), and app.evaluate runs in main through
// that inspector. So the tests that launch the packaged app drive a copy of it in a temporary folder
// with that one fuse turned back on (inspectableCopy). The binary they drive differs from the shipped
// one by EnableNodeCliInspectArguments only, which a test of packaged.spec.ts checks by reading every
// fuse of both. The tests of the fuses themselves (packaged.spec.ts) start the build as it is, and
// `pnpm test:package` reads the fuses of dist/ last (scripts/check-fuses.mjs).
//
// What the flip does to the signature:
// - macOS: the fuses sit in Contents/Frameworks/Electron Framework.framework; a changed byte there
//   breaks the ad-hoc signature of electron-builder, and an arm64 Mac does not start such a binary.
//   @electron/fuses signs the copy ad-hoc again (resetAdHocDarwinSignature: codesign --sign -
//   --force --deep, keeping entitlements, requirements, flags and runtime).
// - Windows: the fuses sit in worfy.exe itself. The build is not signed (no certificate until E4,
//   electron-builder.yml), so there is no signature to break.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses'
import { packagedBuild, repoRoot } from './helpers'

const checkFuses = (await import(pathToFileURL(join(repoRoot, 'scripts', 'check-fuses.mjs')).href)) as {
  fuseStates: (app: string) => Promise<Record<string, string>>
  fuseProblems: (states: Record<string, string>) => string[]
  fuseTarget: (app: string) => string
}

/** Every fuse of a packaged app (worfy.app, or the folder of worfy.exe) by name, with its state: enabled, disabled, removed. */
export const fuseStates = checkFuses.fuseStates
/** One line per fuse that must be off in the packaged worfy and is not (scripts/check-fuses.mjs). */
export const fuseProblems = checkFuses.fuseProblems

/** `path` with links resolved, for a path that may not exist yet: its nearest existing folder resolved, the rest as written. */
function realPath(path: string): string {
  const full = resolve(path)
  if (existsSync(full)) return realpathSync.native(full)
  const parent = dirname(full)
  return parent === full ? full : join(realPath(parent), basename(full))
}

/** True when `path` is `dir` or lies inside it, after links are resolved. */
function inside(path: string, dir: string): boolean {
  const rest = relative(realPath(dir), realPath(path))
  return rest === '' || (!rest.startsWith('..') && !isAbsolute(rest))
}

/**
 * Refuses a path the helper may not write into: one outside the system's temporary folder, or inside
 * `dist` (dist/ of the repository by default: the build the job keeps) or inside `source`, the app a
 * copy is made of.
 */
export function refuseUnlessScratch(path: string, source?: string, dist: string = join(repoRoot, 'dist')): void {
  if (!inside(path, tmpdir())) throw new Error(`the fuse helper writes into a temporary folder only, not ${path}`)
  if (inside(path, dist) || (source !== undefined && inside(path, source))) throw new Error(`the fuse helper does not write into dist/ or into the app it copies: ${path}`)
}

/**
 * Turns EnableNodeCliInspectArguments on in `app`, a copy of the packaged app that a test made in
 * a temporary folder (an install of scripts/install-stable.mjs, or inspectableCopy). Refuses any
 * other path: the helper writes into nothing a test did not make for it. Nothing else of the fuses
 * changes; on macOS the copy is signed ad-hoc again.
 */
export async function enableInspector(app: string): Promise<void> {
  refuseUnlessScratch(app)
  await flipFuses(checkFuses.fuseTarget(app), {
    version: FuseVersion.V1,
    [FuseV1Options.EnableNodeCliInspectArguments]: true,
    resetAdHocDarwinSignature: process.platform === 'darwin',
  })
}

/**
 * Copies the packaged app `app` into `dir`, a new folder of a test under the system's temporary
 * folder, under the same name, and turns EnableNodeCliInspectArguments on in the copy only
 * (enableInspector). Answers the copy. Refuses a `dir` outside the temporary folder, inside dist/
 * or inside `app`, and a copy that is there already. Links in the bundle are copied as they are
 * (verbatimSymlinks), so the copy's Electron Framework is a file of the copy and not a link back
 * into `app`.
 */
export async function inspectableCopy(app: string, dir: string): Promise<string> {
  refuseUnlessScratch(dir, app)
  const copy = join(dir, basename(resolve(app)))
  if (existsSync(copy)) throw new Error(`inspectableCopy makes a new copy, and ${copy} is there already`)
  mkdirSync(dir, { recursive: true })
  cpSync(app, copy, { recursive: true, verbatimSymlinks: true })
  await enableInspector(copy)
  return copy
}

/**
 * The paths under `a` and `b` (with forward slashes) that differ: on one side only, of another kind
 * (file, folder, link), a link to another target, or a file with other bytes. Links are compared,
 * never followed: a framework's Versions/Current would otherwise be walked twice, or forever.
 */
export function bundleDifferences(a: string, b: string, below = ''): string[] {
  const names = new Set([...readdirSync(join(a, below)), ...readdirSync(join(b, below))])
  const found: string[] = []
  for (const name of [...names].sort()) {
    const path = below === '' ? name : `${below}/${name}`
    const [left, right] = [join(a, path), join(b, path)]
    const kind = entryKind(left)
    if (kind !== entryKind(right) || kind === 'none') found.push(path)
    else if (kind === 'folder') found.push(...bundleDifferences(a, b, path))
    else if (kind === 'link' ? readlinkSync(left) !== readlinkSync(right) : !readFileSync(left).equals(readFileSync(right))) found.push(path)
  }
  return found
}

/** What is at `path`, the link itself and not what it leads to. */
function entryKind(path: string): 'none' | 'link' | 'folder' | 'file' {
  try {
    const stat = lstatSync(path)
    return stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'folder' : 'file'
  } catch {
    return 'none'
  }
}

/** inspectableCopy of the dist/ build of `pnpm package`. */
export const inspectableBuild = (dir: string): Promise<string> => inspectableCopy(packagedBuild(), dir)
