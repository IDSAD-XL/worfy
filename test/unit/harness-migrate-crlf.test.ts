// A .claude.json with CRLF line ends keeps them through a Harness move and its undo: the move
// (apply.ts) and restore.mjs (restore.ts) each write JSON "the way the file was", and both copies of
// that rule must keep `\r\n`, not only the indent and the final line end.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { stringifyLike } from '../../src/main/harness/migrate/apply'
import { restoreScriptSource } from '../../src/main/harness/migrate/restore'

type Stringify = (original: string, value: unknown) => string

const dir = mkdtempSync(join(tmpdir(), 'worfy-migrate-crlf-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** stringifyLike of restore.mjs, the script as the move writes it into a backup folder. */
async function restoreStringify(): Promise<Stringify> {
  const script = join(dir, 'restore.mjs')
  writeFileSync(script, restoreScriptSource())
  const module = (await import(/* @vite-ignore */ pathToFileURL(script).href)) as { stringifyLike: Stringify }
  return module.stringifyLike
}

const ORIGINAL = ['{', '  "mcpServers": {', '    "qmd": {', '      "command": "qmd"', '    },', '    "other": {}', '  },', '  "theme": "dark"', '}', ''].join('\r\n')

describe('a CRLF .claude.json through a move and its undo', () => {
  it('the move writes CRLF back, and restore.mjs then gives the original bytes', async () => {
    const restoreLike = await restoreStringify()
    const json = JSON.parse(ORIGINAL) as { mcpServers: Record<string, unknown> }
    const { qmd, ...others } = json.mcpServers
    const moved = stringifyLike(ORIGINAL, { ...json, mcpServers: others })
    expect(moved).not.toMatch(/[^\r]\n/)
    expect(moved.endsWith('}\r\n')).toBe(true)
    const restored = restoreLike(moved, { ...json, mcpServers: { qmd, ...others } })
    expect(restored).toBe(ORIGINAL)
  })

  it('both copies leave an LF file as it was', async () => {
    const restoreLike = await restoreStringify()
    const lf = ORIGINAL.replaceAll('\r\n', '\n')
    expect(stringifyLike(lf, JSON.parse(lf))).toBe(lf)
    expect(restoreLike(lf, JSON.parse(lf))).toBe(lf)
  })
})
