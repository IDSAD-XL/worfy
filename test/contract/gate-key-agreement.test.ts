// One rule picks the gate registry entry of a folder, written twice: gate-resolve.mjs --which (the
// Gate, harness/hooks) and gateKey (the app, src/main/gate/state.ts). test/unit/gate-key-spelling.test.ts
// checks gateKey against that rule on a faked node:fs; here both copies get the same real folders
// and must pick the same entry. The spellings of one folder: its realpath, the path as the system
// temporary folder spells it (a `subst` drive or an 8.3 name when TEMP is one), a link to it (a
// junction on Windows), and on Windows its 8.3 short name when the volume makes one.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { gateKey } from '../../src/main/gate/state'
import { removeTestTree } from '../remove'

const RESOLVE = join(import.meta.dirname, '..', '..', 'harness', 'hooks', 'gate-resolve.mjs')

// Not realpath'd: the temporary folder keeps the spelling TEMP gives it.
const scratch = mkdtempSync(join(tmpdir(), 'worfy-gate-key-'))
afterAll(() => removeTestTree(scratch))

/** The 8.3 short name of a Windows folder, or null when the volume made none. */
function shortName(path: string): string | null {
  const run = spawnSync('cmd.exe', ['/d', '/s', '/c', `"for %I in ("${path}") do @echo %~sI"`], { encoding: 'utf8', windowsVerbatimArguments: true })
  const short = run.stdout.trim()
  return run.status === 0 && short !== '' && short.toLowerCase() !== path.toLowerCase() ? short : null
}

/** The spellings of one real folder, by name; the names of the ones this machine cannot make are skipped. */
function spellings(): Record<string, string> {
  const typed = join(scratch, 'gate key spelling', 'repo')
  mkdirSync(join(typed, 'sub'), { recursive: true })
  const out: Record<string, string> = { long: realpathSync.native(typed), typed }
  const link = join(scratch, 'link')
  symlinkSync(out.long ?? typed, link, process.platform === 'win32' ? 'junction' : 'dir')
  out.link = link
  if (process.platform === 'win32') {
    const short = shortName(join(realpathSync.native(scratch), 'gate key spelling'))
    if (short !== null) out.short = join(short, 'repo')
  }
  return out
}

/** The key gate-resolve.mjs --which picks for `target` in the registry `config`; null for none. */
function which(config: { repos: { key: string; match: string }[] }, target: string): string | null {
  const file = join(scratch, `config-${Math.random().toString(16).slice(2)}.json`)
  writeFileSync(file, JSON.stringify(config))
  const run = spawnSync(process.execPath, [RESOLVE, '--which', target], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: scratch, USERPROFILE: scratch, ELECTRON_RUN_AS_NODE: '1', CLAUDE_GATE_CONFIG: file },
  })
  expect(run.status, run.stderr).toBe(0)
  const key = run.stdout.split('\t')[0]?.trim() ?? ''
  return key === '' ? null : key
}

describe('gate-resolve.mjs --which and gateKey pick the same registry entry', () => {
  const folders = spellings()
  const names = Object.keys(folders)

  it('the folder in its realpath spelling is its own entry in both', async () => {
    const config = { repos: [{ key: 'k', match: folders.long ?? '' }] }
    expect(which(config, folders.long ?? '')).toBe('k')
    expect(await gateKey(config, folders.long ?? '')).toBe('k')
  })

  it.each(names.flatMap((match) => names.map((target) => [match, target])))('a `match` spelled %s, the folder or its subfolder spelled %s', async (matchName, targetName) => {
    const config = { repos: [{ key: 'k', match: folders[matchName] ?? '' }] }
    for (const target of [folders[targetName] ?? '', join(folders[targetName] ?? '', 'sub')]) {
      expect(await gateKey(config, target), target).toBe(which(config, target))
    }
  })

  it('a registry with every spelling as its own entry, and the parent folder: both pick one and the same', async () => {
    const parent = join(folders.long ?? '', '..')
    const config = { repos: [{ key: 'parent', match: parent }, ...names.map((name) => ({ key: name, match: folders[name] ?? '' }))] }
    for (const name of names) {
      const target = folders[name] ?? ''
      const picked = which(config, target)
      expect(picked, target).not.toBeNull()
      expect(await gateKey(config, target), target).toBe(picked)
    }
  })
})
