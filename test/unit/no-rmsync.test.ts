// fs.rmSync is not used in src/ (worfy-windows ticket 23). Under the Node of Electron 44 on Windows
// its `recursive` goes through a junction and empties the folder behind it, and without `recursive`
// it refuses a read-only file and a junction. Removals go through src/main/storage/remove.ts.
//
// The search is by text, not by an ESLint rule: one of the places is JavaScript inside a string —
// the script restore.mjs in src/main/harness/migrate/restore.ts — which a rule would not see.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', '..', 'src')

/** Every .ts and .tsx file under a folder. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/**
 * The lines of a text that use rmSync: any mention outside a comment line. A line that only says
 * why rmSync is not used — `// …` or ` * …` — is not a use.
 */
function uses(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /\brmSync\b/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line))
    .map(({ line, number }) => `${number}: ${line.trim()}`)
}

describe('fs.rmSync in src/', () => {
  it('is used nowhere: a file, a link or a folder is removed with removeFile or removeTree of src/main/storage/remove.ts', () => {
    const found = sources(SRC).flatMap((file) => uses(readFileSync(file, 'utf8')).map((use) => `${relative(SRC, file).replace(/\\/g, '/')}:${use}`))
    expect(found).toEqual([])
  })

  it('the search finds a call, an import and a call inside a string, with "recursive" and without, and passes a comment by', () => {
    expect(uses("    rmSync(dir, { recursive: true, force: true })")).toEqual(['1: rmSync(dir, { recursive: true, force: true })'])
    expect(uses("  rmSync(file, { force: true })")).toHaveLength(1)
    expect(uses("import { mkdirSync, rmSync } from 'node:fs'")).toHaveLength(1)
    expect(uses('const remove = fs.rmSync')).toHaveLength(1)
    expect(uses("const SOURCE = String.raw`\n    if (move) rmSync(path, { recursive: true, force: true })\n`")).toEqual(['2: if (move) rmSync(path, { recursive: true, force: true })'])
    expect(uses('// fs.rmSync is not used here\n * rmSync would go through a junction\n/* rmSync */')).toEqual([])
    // Another name that only holds these letters is not it.
    expect(uses('const rmSyncLike = 1; warmSync()')).toEqual([])
  })
})
