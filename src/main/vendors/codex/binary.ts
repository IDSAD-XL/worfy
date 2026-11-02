// Where the Codex binary of this build is (worfy-multi-vendor ticket 17). worfy runs the Codex it
// pins (`@openai/codex` in package.json, an exact version), never one the user installed: the
// protocol types of src/main/vendors/codex/protocol/ are that version's.
import { createRequire } from 'node:module'
import { dirname, posix, win32 } from 'node:path'

/** The app as the path depends on it; the same shape as Claude's RuntimeInfo, so one object serves both. */
export interface CodexRuntime {
  /** app.isPackaged */
  packaged: boolean
  /** process.resourcesPath: Contents/Resources of the .app */
  resourcesPath: string
  platform: NodeJS.Platform
  arch: string
}

/**
 * The Rust target each platform package of @openai/codex keeps its binary under, as its launcher
 * (bin/codex.js) names them. A platform and architecture not here has no Codex.
 */
const TARGETS: Readonly<Record<string, string>> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
}

/**
 * The folder of an installed platform package of @openai/codex (`@openai/codex-darwin-arm64`), found
 * the way the package's launcher finds it; undefined when it is not installed.
 */
export type CodexPackageResolver = (name: string) => string | undefined

/** The platform package next to @openai/codex in node_modules (pnpm installs only this machine's). */
const installedPackage: CodexPackageResolver = (name) => {
  try {
    const codex = createRequire(import.meta.url).resolve('@openai/codex/package.json')
    return dirname(createRequire(codex).resolve(`${name}/package.json`))
  } catch {
    return undefined
  }
}

/**
 * The Codex binary to run. In the packaged app:
 * <Resources>/app.asar.unpacked/node_modules/@openai/codex-<platform>-<arch>/vendor/<target>/bin/codex,
 * codex.exe on Windows; electron-builder.yml unpacks that package (asarUnpack), as a file inside
 * app.asar cannot be run (ADR-0008). Otherwise (`pnpm dev`, tests) the same file of the package in
 * node_modules, through `resolvePackage`. Undefined when this platform has no Codex package or it is
 * not installed. The path is built with the separators of the runtime's platform, not of the machine
 * that runs this code, so tests of either platform run anywhere.
 */
export function codexExecutablePath(runtime: CodexRuntime, resolvePackage: CodexPackageResolver = installedPackage): string | undefined {
  const target = TARGETS[`${runtime.platform}-${runtime.arch}`]
  if (target === undefined) return undefined
  const windows = runtime.platform === 'win32'
  const paths = windows ? win32 : posix
  const name = `codex-${runtime.platform}-${runtime.arch}`
  const folder = runtime.packaged ? paths.join(runtime.resourcesPath, 'app.asar.unpacked', 'node_modules', '@openai', name) : resolvePackage(`@openai/${name}`)
  if (folder === undefined) return undefined
  return paths.join(folder, 'vendor', target, 'bin', windows ? 'codex.exe' : 'codex')
}
