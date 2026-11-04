// The e2e specs run in Playwright's own loader, outside vite, and some of them import worfy's source
// (test/e2e/epic-frame.spec.ts takes codeSection from src/main/workflow/reader.ts). A module those imports reach
// that uses `import.meta.glob` — vite's, absent there — throws at load, and Playwright then loads no spec at all:
// that is how #1323 turned every e2e job red, when the reader started to take repoPageUrl from a module whose
// imports reach src/main/terminal/shell-integration.ts. vitest runs through vite, so a plain import here would
// load fine; this test walks the static imports of the source instead.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = join(import.meta.dirname, '..', '..')
const CODE = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.cjs']

// `import … from '<x>'`, `import '<x>'`, `export … from '<x>'`; `import type` and `export type` are erased and not
// followed, nor are dynamic `import()` calls, which load on use.
const STATIC_IMPORT = /(?:^|[\n;])\s*(?:import|export)\s+(type\s+)?(?:[^'"`;]*?\s+from\s+)?['"]([^'"\n]+)['"]/g

/** The file a relative specifier names, or null for a package. Throws for a relative one that names no file. */
function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = join(dirname(from), specifier)
  const candidates = [base, ...CODE.map((ext) => base + ext), base.replace(/\.js$/, '.ts'), ...CODE.map((ext) => join(base, `index${ext}`))]
  const found = candidates.find((path) => existsSync(path) && statSync(path).isFile())
  if (found === undefined) throw new Error(`${relative(REPO, from)}: cannot resolve ${specifier}`)
  return found
}

/** Every source file the static imports of `roots` reach, the roots included, as paths relative to the repository. */
function reached(roots: readonly string[]): string[] {
  const seen = new Set<string>()
  const queue = [...roots]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    if (!CODE.includes(extname(file))) continue
    for (const match of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      if (match[1]) continue
      const target = resolveImport(file, match[2]!)
      if (target !== null) queue.push(target)
    }
  }
  return [...seen].map((file) => relative(REPO, file).split(sep).join('/')).sort()
}

const usesGlob = (file: string): boolean => /import\.meta\.glob\b/.test(readFileSync(join(REPO, file), 'utf8'))

function e2eFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return e2eFiles(path)
    return /\.(ts|mts|mjs)$/.test(entry.name) ? [path] : []
  })
}

describe('the modules the e2e specs load outside vite', () => {
  const reader = reached([join(REPO, 'src', 'main', 'workflow', 'reader.ts')])

  it('the walk follows the reader into the modules it imports', () => {
    expect(reader).toContain('src/main/workflow/reader.ts')
    expect(reader).toContain('src/main/github/remote.ts')
    expect(reader).toContain('src/shared/workflow/evidence.ts')
  })

  it('the workflow reader reaches nothing under src/main/terminal/ and no module with import.meta.glob', () => {
    expect(reader.filter((file) => file.startsWith('src/main/terminal/'))).toEqual([])
    expect(reader.filter(usesGlob)).toEqual([])
  })

  it('no e2e spec or helper reaches a module with import.meta.glob', () => {
    const specs = e2eFiles(join(REPO, 'test', 'e2e'))
    expect(specs.some((file) => file.endsWith('epic-frame.spec.ts'))).toBe(true)
    expect(reached(specs).filter(usesGlob)).toEqual([])
  })

  it('finds a module with import.meta.glob through the imports: the module that #1323 reached', () => {
    const shell = reached([join(REPO, 'src', 'main', 'github', 'accounts.ts')])
    expect(shell).toContain('src/main/terminal/pty.ts')
    expect(shell.filter(usesGlob)).toContain('src/main/terminal/shell-integration.ts')
  })
})
