// A copy of one real src/ module whose import.meta.glob is under test, built outside the
// repository (ADR-0036). The discovery tests used to write their probe files into src/ itself;
// that made them depend on which test file Vite transformed a module for first, and the probes
// leaked into lint, typecheck, build and other test files while they existed.
//
// globProbe() mirrors the repository in a fresh temporary directory: every directory on the way
// to the glob's directory is a real directory there, every other entry is a symlink to the real
// one, the module under test is a byte-for-byte copy of the real file, and the probe files sit
// next to the symlinked real ones. Importing the copy makes Vite expand the module's own,
// unedited glob pattern over that directory: the result holds the real files and the probe, and
// the module's other imports (relative ones through the symlinks, bare ones through the
// node_modules symlink) resolve to the same real modules as everywhere else. A typo in the
// pattern, or a glob replaced by a hand-written list, still loses the probe.
//
// The file is .tsx, not .ts, because only the jsdom tests import it and tsconfig.test.web.json
// lists test/**/*.tsx. That project is type-checked without Node's types (the renderer has none),
// so node:fs, node:os and node:process are loaded through computed specifiers and given the few
// signatures used here.

interface Fs {
  copyFileSync(from: string, to: string): void
  mkdirSync(path: string): unknown
  mkdtempSync(prefix: string): string
  readdirSync(path: string): string[]
  realpathSync(path: string): string
  rmSync(path: string, options: { recursive: true; force: true }): void
  symlinkSync(target: string, path: string): void
  writeFileSync(path: string, data: string): void
}

const nodeModule = async <T,>(name: string): Promise<T> => (await import(/* @vite-ignore */ ['node', name].join(':'))) as T

export interface GlobProbeOptions {
  /** The module whose glob is under test, relative to the repository root, e.g. 'src/renderer/shell/Sidebar.tsx'. */
  module: string
  /** The directory its glob searches, relative to the repository root; the module's own directory or one below it. */
  globDir: string
  /** Probe files to add to that directory: file name → source. */
  probes: Record<string, string>
}

export interface GlobProbe {
  /** Absolute path of the copy of the module; import it instead of the real one. */
  modulePath: string
  /** Deletes the temporary tree. */
  remove(): void
}

/** vitest runs with the repository root as cwd. */
export async function globProbe({ module, globDir, probes }: GlobProbeOptions): Promise<GlobProbe> {
  const fs = await nodeModule<Fs>('fs')
  const { tmpdir } = await nodeModule<{ tmpdir(): string }>('os')
  const { cwd } = await nodeModule<{ cwd(): string }>('process')
  const repo = cwd()
  const moduleDir = module.slice(0, module.lastIndexOf('/'))
  if (globDir !== moduleDir && !globDir.startsWith(`${moduleDir}/`)) throw new Error(`${globDir} is not ${moduleDir} or below it`)

  // The real path: Vite resolves symlinks, and /tmp on macOS is itself one.
  const root = fs.realpathSync(fs.mkdtempSync(`${tmpdir()}/worfy-glob-probe-`))
  try {
    // '' is the repository root; then src, src/renderer, … down to the glob's directory.
    const segments = globDir.split('/')
    const chain = ['', ...segments.map((_, i) => segments.slice(0, i + 1).join('/'))]
    for (const [i, dir] of chain.entries()) {
      if (dir !== '') fs.mkdirSync(`${root}/${dir}`)
      const next = chain[i + 1]
      for (const entry of fs.readdirSync(`${repo}/${dir}`)) {
        const path = dir === '' ? entry : `${dir}/${entry}`
        if (path === next || path === module || entry === '.git') continue
        fs.symlinkSync(`${repo}/${path}`, `${root}/${path}`)
      }
    }
    fs.copyFileSync(`${repo}/${module}`, `${root}/${module}`)
    for (const [name, source] of Object.entries(probes)) fs.writeFileSync(`${root}/${globDir}/${name}`, source)
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true })
    throw error
  }
  return {
    modulePath: `${root}/${module}`,
    remove: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}
