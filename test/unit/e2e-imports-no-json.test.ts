// The e2e specs run under Playwright, whose loader takes a static JSON import only with an import attribute
// (`with { type: 'json' }`); without one it refuses the module, the spec file loads no test, and every e2e job finds
// 0 tests (PR #1910, round 1: src/main/workflow/reader.ts reached src/shared/stories/labels.json through the story
// parser). vite and vitest take such an import, so only the e2e jobs would see it. This walks the relative imports
// of every spec, as written, and names the JSON module and the chain that reaches it.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const E2E = join(ROOT, 'test', 'e2e')

/** The static imports and re-exports of `source`: their specifiers and whether they carry an import attribute. */
function importsOf(source: string): { from: string; attribute: boolean }[] {
  const found: { from: string; attribute: boolean }[] = []
  // `import type` and `export type` are erased before the module loads, so they reach no JSON at run time.
  for (const match of source.matchAll(/^\s*(?:import|export)\s(?!type\s)[^'"`;]*?\bfrom\s+['"]([^'"]+)['"](\s+with\s*\{[^}]*\})?/gmu)) {
    found.push({ from: match[1]!, attribute: match[2] !== undefined })
  }
  for (const match of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gmu)) found.push({ from: match[1]!, attribute: false })
  return found
}

/** The file a relative specifier names: as written, or with a TypeScript ending or index. */
function resolveFile(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && !readdirSafe(candidate)) return candidate
  }
  return null
}

const readdirSafe = (path: string): boolean => {
  try {
    readdirSync(path)
    return true
  } catch {
    return false
  }
}

/** Every JSON module a spec reaches by static relative imports without an attribute, with the chain that reaches it. */
function jsonReached(spec: string): string[] {
  const seen = new Set<string>()
  const problems: string[] = []
  const walk = (file: string, chain: string[]): void => {
    if (seen.has(file)) return
    seen.add(file)
    for (const { from, attribute } of importsOf(readFileSync(file, 'utf8'))) {
      if (!from.startsWith('.')) continue
      const target = resolveFile(file, from)
      if (target === null) continue
      const here = [...chain, relative(ROOT, target)]
      if (target.endsWith('.json')) {
        if (!attribute) problems.push(here.join(' → '))
      } else if (/\.tsx?$/u.test(target)) walk(target, here)
    }
  }
  walk(spec, [relative(ROOT, spec)])
  return problems
}

describe('the e2e specs load under Playwright', () => {
  it('reach no JSON module without an import attribute through their relative imports', () => {
    const specs = readdirSync(E2E).filter((name) => name.endsWith('.ts'))
    expect(specs.length).toBeGreaterThan(0)
    expect(specs.flatMap((name) => jsonReached(join(E2E, name)))).toEqual([])
  })
})
