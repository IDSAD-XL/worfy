import { execFileSync } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { projectDirName } from '../../src/main/claude-home/registry'
import { GateReader, gateKey, gateTag, lastGateOutcome, listWorktrees, markerOutcome, outputTexts, TranscriptGateScanner, type Worktree } from '../../src/main/gate/state'
import { worktreeOfCwd, worktreeOfTicket, type ChecksSnapshot } from '../../src/shared/ipc/checks'

// The gate's verdict per worktree (ticket 17): gate.sh's tag, the key from gate/config.json, the
// red/unverified markers, and the last `[gate]` line of the worktree's transcripts.

const temps: string[] = []
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-gate-')))
  temps.push(dir)
  return dir
}

describe('gateTag', () => {
  it.each(['/Users/alexey/Stuff/CanvasForAI', '/Users/test/projects/demo/.claude/worktrees/07', '/tmp/с пробелом и юникодом'])(
    'equals the first 8 hex digits of `printf %%s <path> | shasum` for %s',
    (path) => {
      const expected = execFileSync('/bin/sh', ['-c', 'printf "%s" "$1" | shasum | cut -c1-8', 'sh', path], { encoding: 'utf8' }).trim()
      expect(gateTag(path)).toBe(expected)
    },
  )
})

describe('gateKey', () => {
  const config = {
    repos: [
      { key: 'outer', match: '/Users/test/projects' },
      { key: 'demo', match: '/Users/test/projects/demo' },
      { key: 'demo-other', match: '/Users/test/projects/demo-other' },
    ],
  }

  it('takes the longest `match` that is the root or a folder above it', async () => {
    expect(await gateKey(config, '/Users/test/projects/demo')).toBe('demo')
    expect(await gateKey(config, '/Users/test/projects/demo/sub')).toBe('demo')
    expect(await gateKey(config, '/Users/test/projects/elsewhere')).toBe('outer')
  })

  it('does not take a `match` that only starts like the root', async () => {
    expect(await gateKey({ repos: [{ key: 'demo', match: '/Users/test/projects/demo' }] }, '/Users/test/projects/demo-other')).toBeNull()
  })

  it('is null without a config or without a matching entry', async () => {
    expect(await gateKey(null, '/Users/test/projects/demo')).toBeNull()
    expect(await gateKey(config, '/Volumes/x')).toBeNull()
  })
})

describe('markerOutcome', () => {
  it('reads red and unverified markers of this key and tag only; red wins', () => {
    expect(markerOutcome(new Set(['red-worfy-abcdef12']), 'worfy', 'abcdef12')).toBe('red')
    expect(markerOutcome(new Set(['unverified-worfy-abcdef12']), 'worfy', 'abcdef12')).toBe('unverified')
    expect(markerOutcome(new Set(['unverified-worfy-abcdef12', 'red-worfy-abcdef12']), 'worfy', 'abcdef12')).toBe('red')
    expect(markerOutcome(new Set(['red-auction-abcdef12', 'red-worfy-00000000', 'nokey-broken-abcdef12-s']), 'worfy', 'abcdef12')).toBeNull()
  })
})

describe('lastGateOutcome', () => {
  it.each([
    ['[gate] набор (fast): все пакеты\n[gate] зелено (fast): worfy/.:lint', 'green'],
    ['[gate] красно (fast): worfy/.:test (прошло: lint)', 'red'],
    ['[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: node не найден', 'unverified'],
    ['[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ — окружение недоступно:', 'unverified'],
    ['[gate] ничего не прогналось (fast): нет изменений. Это не «зелено».', 'none'],
    ['[gate] зелено (fast): a\n…\n[gate] ничего не прогналось (fast): b', 'none'],
    ['[gate] красно (fast): a\nКОД=2\n[gate] зелено (fast): a', 'green'],
  ])('%j → %s', (text, outcome) => {
    expect(lastGateOutcome(text)).toBe(outcome)
  })

  it('ignores lines that only mention the gate, not at the start of a line', () => {
    expect(lastGateOutcome('  echo "[gate] зелено ($PROFILE)"\n361:        echo "[gate] красно"')).toBeNull()
    expect(lastGateOutcome('[gate] набор (fast): все пакеты')).toBeNull()
  })
})

describe('outputTexts', () => {
  it('takes tool results and hook output', () => {
    expect(outputTexts({ type: 'user', message: { content: [{ type: 'tool_result', content: '[gate] зелено (fast): x' }] } })).toEqual(['[gate] зелено (fast): x'])
    expect(outputTexts({ type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'a' }, { type: 'image' }] }] } })).toEqual(['a'])
    expect(outputTexts({ type: 'attachment', attachment: { type: 'hook_success', content: 'c', stdout: 'o', stderr: 'e' } })).toEqual(['c', 'o', 'e'])
    expect(outputTexts({ type: 'system', subtype: 'stop_hook_summary', hookErrors: ['[gate] красно (fast): x'] })).toEqual(['[gate] красно (fast): x'])
  })

  it('leaves out prompts, briefs, task notifications and the model’s own text', () => {
    expect(outputTexts({ type: 'user', message: { content: '[gate] зелено (…)' } })).toEqual([])
    expect(outputTexts({ type: 'user', message: { content: [{ type: 'text', text: '[gate] зелено (…)' }] } })).toEqual([])
    expect(outputTexts({ type: 'assistant', message: { content: [{ type: 'text', text: '[gate] зелено (…)' }] } })).toEqual([])
    expect(outputTexts({ type: 'attachment', attachment: { type: 'queued_command', prompt: '[gate] зелено (…)' } })).toEqual([])
    expect(outputTexts({ type: 'queue-operation', content: '[gate] зелено (…)' })).toEqual([])
  })
})

// ── a Project with a worktree of Ticket 07 ──────────────────────────────────

const toolResult = (text: string, timestamp: string) => JSON.stringify({ type: 'user', timestamp, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: text }] } })
const prompt = (text: string, timestamp: string) => JSON.stringify({ type: 'user', timestamp, message: { role: 'user', content: text } })

interface World {
  home: string
  root: string
  worktree07: string
  worktrees: Worktree[]
  transcript: string
  marker: string
}

async function world(): Promise<World> {
  const base = await tempDir()
  const home = join(base, 'claude')
  const root = join(base, 'demo')
  const worktree07 = join(root, '.claude', 'worktrees', '07')
  await mkdir(join(home, 'gate', 'state'), { recursive: true })
  await mkdir(worktree07, { recursive: true })
  await writeFile(join(home, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'worfy', match: root, profile: 'worfy', pm: 'pnpm' }] }))
  const folder = join(home, 'projects', projectDirName(worktree07))
  await mkdir(folder, { recursive: true })
  const transcript = join(folder, '44444444-4444-4444-8444-444444444444.jsonl')
  await writeFile(
    transcript,
    [
      toolResult('[gate] красно (fast): worfy/.:test', '2026-10-05T10:00:00.000Z'),
      toolResult('[gate] набор (fast): все пакеты\n[gate] зелено (fast): worfy/.:lint worfy/.:typecheck worfy/.:test', '2026-10-05T10:05:00.000Z'),
      prompt('Brief: finish when `[gate] красно` is gone\n[gate] красно (fast): quoted', '2026-10-05T10:06:00.000Z'),
      '',
    ].join('\n'),
  )
  const marker = join(home, 'gate', 'state', `red-worfy-${gateTag(worktree07)}`)
  await writeFile(marker, '')
  return { home, root, worktree07, worktrees: [{ path: root, branch: 'main' }, { path: worktree07, branch: 'demo/07' }], transcript, marker }
}

const snapshotOf = (root: string, worktrees: ChecksSnapshot['worktrees']): ChecksSnapshot => ({ root, worktrees, pulls: [], gh: { available: true, error: null, intervalMs: 60_000 } })

describe('GateReader', () => {
  it('a red marker of the worktree of Ticket 07 makes Ticket 07 and a Session in that worktree red; without it, the transcript’s last gate line says green', async () => {
    const { home, root, worktree07, worktrees, marker } = await world()
    const reader = new GateReader({ home })

    const red = snapshotOf(root, await reader.read(root, worktrees))
    expect(worktreeOfTicket(red, { epic: 'demo', num: 7 })?.gate).toEqual({ outcome: 'red', source: 'marker', at: null })
    expect(worktreeOfCwd(red, join(worktree07, 'src'))?.gate.outcome).toBe('red')
    expect(worktreeOfCwd(red, root)?.gate).toEqual({ outcome: 'none', source: 'none', at: null })

    await rm(marker)
    const green = snapshotOf(root, await reader.read(root, worktrees))
    expect(worktreeOfTicket(green, { epic: 'demo', num: 7 })?.gate).toEqual({ outcome: 'green', source: 'transcript', at: '2026-10-05T10:05:00.000Z' })
    expect(worktreeOfCwd(green, worktree07)?.gate.outcome).toBe('green')
    expect(worktreeOfTicket(green, { epic: 'demo', num: 8 })).toBeNull()
  })

  it('reads an unverified marker, and nothing for a marker of another key', async () => {
    const { home, root, worktree07, worktrees, marker } = await world()
    await rm(marker)
    await writeFile(join(home, 'gate', 'state', `red-auction-${gateTag(worktree07)}`), '')
    await writeFile(join(home, 'gate', 'state', `unverified-worfy-${gateTag(worktree07)}`), '')
    const [, wt07] = await new GateReader({ home }).read(root, worktrees)
    expect(wt07!.gate).toEqual({ outcome: 'unverified', source: 'marker', at: null })
  })

  it('ignores markers when the Project has no key in gate/config.json, and reads the transcript', async () => {
    const { home, root, worktrees } = await world()
    await writeFile(join(home, 'gate', 'config.json'), JSON.stringify({ repos: [{ key: 'worfy', match: '/somewhere/else' }] }))
    const [, wt07] = await new GateReader({ home }).read(root, worktrees)
    expect(wt07!.gate.outcome).toBe('green')
  })

  it('«ничего не прогналось» after a green line is «нет данных», not green', async () => {
    const { home, root, worktrees, transcript, marker } = await world()
    await rm(marker)
    const reader = new GateReader({ home })
    expect((await reader.read(root, worktrees))[1]!.gate.outcome).toBe('green')
    await appendFile(transcript, `${toolResult('[gate] ничего не прогналось (fast): нет изменений. Это не «зелено».', '2026-10-05T11:00:00.000Z')}\n`)
    expect((await reader.read(root, worktrees))[1]!.gate).toEqual({ outcome: 'none', source: 'transcript', at: '2026-10-05T11:00:00.000Z' })
  })

  it('takes the latest gate line across the worktree’s transcripts, by record time', async () => {
    const { home, root, worktree07, worktrees, marker } = await world()
    await rm(marker)
    const folder = join(home, 'projects', projectDirName(worktree07))
    await writeFile(join(folder, '55555555-5555-4555-8555-555555555555.jsonl'), `${toolResult('[gate] красно (fast): later', '2026-10-05T12:00:00.000Z')}\n`)
    await writeFile(join(folder, '66666666-6666-4666-8666-666666666666.jsonl'), `${toolResult('[gate] зелено (fast): earlier', '2026-10-05T09:00:00.000Z')}\n`)
    expect((await new GateReader({ home }).read(root, worktrees))[1]!.gate).toEqual({ outcome: 'red', source: 'transcript', at: '2026-10-05T12:00:00.000Z' })
  })

  it('writes nothing under the Claude home or in the Project', async () => {
    const { home, root, worktrees, marker } = await world()
    const listing = async (dir: string): Promise<string[]> => {
      const out: string[] = []
      for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
        const path = join(entry.parentPath, entry.name)
        const info = await stat(path)
        out.push(`${path} ${info.size} ${info.mtimeMs}`)
      }
      return out.sort()
    }
    const before = [await listing(home), await listing(root)]
    const reader = new GateReader({ home })
    await reader.read(root, worktrees)
    await rm(marker)
    const afterRemoval = [await listing(home), await listing(root)]
    await reader.read(root, worktrees)
    expect([await listing(home), await listing(root)]).toEqual(afterRemoval)
    expect(afterRemoval[0]!.length).toBe(before[0]!.length - 1)
  })
})

describe('TranscriptGateScanner', () => {
  it('reads only what was appended since the last read, and starts over on a replaced file', async () => {
    const dir = await tempDir()
    const file = join(dir, 's.jsonl')
    await writeFile(file, `${toolResult('[gate] зелено (fast): a', '2026-10-05T10:00:00.000Z')}\n`)
    const scanner = new TranscriptGateScanner()
    expect((await scanner.lastIn(dir))?.outcome).toBe('green')
    await appendFile(file, `${prompt('no gate here', '2026-10-05T10:01:00.000Z')}\n`)
    expect((await scanner.lastIn(dir))?.outcome).toBe('green')
    await appendFile(file, `${toolResult('[gate] красно (fast): b', '2026-10-05T10:02:00.000Z')}\n`)
    expect((await scanner.lastIn(dir))?.outcome).toBe('red')
    await rm(file)
    await writeFile(file, `${prompt('fresh', '2026-10-05T10:03:00.000Z')}\n`)
    expect(await scanner.lastIn(dir)).toBeNull()
  })

  it('is null for a folder that does not exist', async () => {
    expect(await new TranscriptGateScanner().lastIn('/nonexistent/worfy-gate')).toBeNull()
  })
})

describe('listWorktrees', () => {
  it('lists the checkout first, then the worktrees with their branches', async () => {
    const dir = await tempDir()
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
    const root = join(dir, 'repo')
    await mkdir(root)
    git(root, 'init', '-q')
    git(root, 'commit', '-q', '--allow-empty', '-m', 'init')
    git(root, 'worktree', 'add', '-q', '-b', 'demo/07', join(root, '.claude', 'worktrees', '07'))
    expect(await listWorktrees(root)).toEqual([
      { path: root, branch: 'main' },
      { path: join(root, '.claude', 'worktrees', '07'), branch: 'demo/07' },
    ])
  })

  it('is just the root outside git', async () => {
    const dir = await tempDir()
    expect(await listWorktrees(dir)).toEqual([{ path: dir, branch: null }])
  })
})
