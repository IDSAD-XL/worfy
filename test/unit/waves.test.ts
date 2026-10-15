import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codeSection } from '../../src/main/workflow/reader'
import { runWaveState } from '../../src/shared/actions/render-template'
import { initialCycle, step } from '../../src/shared/autopilot/cycle'
import { DEFAULT_ACTION_TEMPLATES } from '../../src/shared/projects/action-templates'
import { epicStatusSchema, type Ticket } from '../../src/shared/workflow/types'
import { readyWave, ticketLevels, waveNumbers } from '../../src/shared/workflow/waves'

const FIXTURE = join(import.meta.dirname, '../fixtures/worfy-mvp-epic')

/** A Ticket of epic `e` with the given number, state, blockers and files. */
function ticket(num: number, over: Partial<Ticket> = {}): Ticket {
  return {
    epic: 'e',
    num,
    slug: `t${num}`,
    title: `${num}`,
    statusRaw: 'open',
    state: 'open',
    blockedRaw: null,
    blockedNums: [],
    blockedParsed: true,
    files: [`src/t${num}.ts`],
    filesListed: true,
    fromBranch: null,
    ...over,
  }
}

const blocked = (...nums: number[]): Partial<Ticket> => ({ blockedNums: nums, blockedRaw: nums.join(', ') })

/** The copy of the worfy-mvp epic, every Ticket open, read the way the reader reads it. */
function fixtureTickets(): Ticket[] {
  const snapshot = epicStatusSchema.parse(JSON.parse(readFileSync(join(FIXTURE, 'epic-status.json'), 'utf8')))
  const issues = readdirSync(join(FIXTURE, 'issues'))
  return snapshot.tickets.map((t) => {
    const file = issues.find((name) => name === `${String(t.num).padStart(2, '0')}-${t.slug}.md`)
    if (!file) throw new Error(`no issue file for ${t.num}`)
    const section = codeSection(readFileSync(join(FIXTURE, 'issues', file), 'utf8'))
    return { ...t, files: section.files, filesListed: section.listed, fromBranch: null }
  })
}

/** Ticket number → wave, from the "## Волны" table of the fixture spec.md. */
function expectedWaves(): Map<number, number> {
  const spec = readFileSync(join(FIXTURE, 'spec.md'), 'utf8')
  const section = spec.slice(spec.indexOf('## Волны'))
  const table = new Map<number, number>()
  for (const line of section.split('\n')) {
    const match = /^\|\s*(\d+)\s*\|.*\|\s*(\d+)\s*\|\s*$/.exec(line)
    if (match) table.set(Number(match[1]), Number(match[2]))
  }
  return table
}

describe('waves on the copy of the worfy-mvp epic', () => {
  it('reproduces the "Волны" table of spec.md for every Ticket', () => {
    const tickets = fixtureTickets()
    const expected = expectedWaves()
    expect(tickets).toHaveLength(33)
    expect(expected.size).toBe(33)

    const waves = waveNumbers(tickets)
    const actual = new Map(tickets.map((t) => [t.num, waves.get(t.num) ?? null]))
    expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected))
  })

  it('keeps every wave of the table free of shared files', () => {
    const tickets = fixtureTickets()
    const waves = waveNumbers(tickets)
    const byWave = new Map<number, string[]>()
    for (const t of tickets) {
      const wave = waves.get(t.num)
      if (wave === undefined) continue
      byWave.set(wave, [...(byWave.get(wave) ?? []), ...t.files])
    }
    for (const files of byWave.values()) expect(new Set(files).size).toBe(files.length)
  })

  it('reads the files of the "Где в коде" section of a real Ticket', () => {
    const ten = fixtureTickets().find((t) => t.num === 10)
    expect(ten?.files).toEqual([
      'src/main/workflow/reader.ts',
      'src/main/workflow/watch.ts',
      'src/shared/workflow/types.ts',
      'src/shared/workflow/waves.ts',
      'src/shared/workflow/ticket-ref.ts',
      'src/main/ipc/workflow.ts',
      'src/shared/ipc/workflow.ts',
      'test/fixtures/worfy-mvp-epic/',
    ])
  })
})

describe('codeSection', () => {
  it('takes backticked paths from list items of the section only', () => {
    const markdown = [
      '# 07 — title',
      '',
      'Mentions `src/elsewhere.ts` in prose.',
      '',
      '## Где в коде',
      '',
      '- `src/a.ts`, `src/b.ts` — what changes',
      '  * `src/c.ts`',
      '1. `src/d.ts`',
      'Prose with `not/a/list/item.ts`.',
      '',
      '## Итог',
      '- `src/after.ts`',
    ].join('\n')
    expect(codeSection(markdown)).toEqual({ listed: true, files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'] })
  })

  it('tells a missing section apart from an empty one', () => {
    expect(codeSection('# t\n\n## Что делаем\n- `src/a.ts`\n')).toEqual({ listed: false, files: [] })
    expect(codeSection('# t\n\n## Где в коде\n\nнет файлов\n')).toEqual({ listed: true, files: [] })
  })

  it('ignores a heading inside a fenced code block', () => {
    const markdown = '# t\n\n```md\n## Где в коде\n- `src/fake.ts`\n```\n\n## Где в коде\n- `src/real.ts`\n'
    expect(codeSection(markdown)).toEqual({ listed: true, files: ['src/real.ts'] })
  })
})

describe('ticket levels', () => {
  it('is 0 without blockers and 1 + the highest blocker level otherwise', () => {
    const levels = ticketLevels([ticket(1), ticket(2, blocked(1)), ticket(3, blocked(1, 2)), ticket(4, blocked(1))])
    expect(levels.get(1)).toEqual({ kind: 'level', level: 0 })
    expect(levels.get(2)).toEqual({ kind: 'level', level: 1 })
    expect(levels.get(3)).toEqual({ kind: 'level', level: 2 })
    expect(levels.get(4)).toEqual({ kind: 'level', level: 1 })
  })

  it('marks a cycle instead of looping or picking a level', () => {
    const levels = ticketLevels([ticket(1, blocked(3)), ticket(2, blocked(1)), ticket(3, blocked(2)), ticket(4, blocked(3)), ticket(5)])
    expect(levels.get(1)).toEqual({ kind: 'cycle', cycle: [1, 2, 3] })
    expect(levels.get(2)).toEqual({ kind: 'cycle', cycle: [1, 2, 3] })
    expect(levels.get(3)).toEqual({ kind: 'cycle', cycle: [1, 2, 3] })
    expect(levels.get(4)).toEqual({ kind: 'after-problem', blockers: [3] })
    expect(levels.get(5)).toEqual({ kind: 'level', level: 0 })
  })

  it('marks a self-blocking Ticket as a cycle', () => {
    expect(ticketLevels([ticket(1, blocked(1))]).get(1)).toEqual({ kind: 'cycle', cycle: [1] })
  })

  it('marks an unparsed "Blocked by" and a blocker that is not in the Epic', () => {
    const levels = ticketLevels([
      ticket(1, { blockedParsed: false, blockedRaw: 'Пакет юристу', blockedNums: [] }),
      ticket(2, blocked(9)),
      ticket(3, blocked(1)),
    ])
    expect(levels.get(1)).toEqual({ kind: 'unparsed', raw: 'Пакет юристу' })
    expect(levels.get(2)).toEqual({ kind: 'missing-blocker', missing: [9] })
    expect(levels.get(3)).toEqual({ kind: 'after-problem', blockers: [1] })
  })

  it('keeps Epics apart: the same number in another Epic is another Ticket', () => {
    const levels = ticketLevels([ticket(1), ticket(2, { ...blocked(1), epic: 'other' })], 'other')
    expect(levels.get(2)).toEqual({ kind: 'missing-blocker', missing: [1] })
  })
})

describe('ready wave', () => {
  it('takes open Tickets whose blockers are all done, in number order', () => {
    const wave = readyWave([
      ticket(3, blocked(1)),
      ticket(1, { state: 'done', statusRaw: 'done' }),
      ticket(2, blocked(4)),
      ticket(4),
      ticket(5, { state: 'blocked', statusRaw: 'blocked' }),
    ])
    expect(wave.ready.map((r) => r.num)).toEqual([3, 4])
    expect(wave.waiting).toContainEqual({ num: 2, reason: { kind: 'blockers', blockers: [4] } })
  })

  it('leaves out a Ticket that shares a file with a Ticket already taken into the wave', () => {
    const wave = readyWave([ticket(1, { files: ['src/a.ts', 'src/b.ts'] }), ticket(2, { files: ['src/b.ts'] }), ticket(3, { files: ['src/c.ts'] })])
    expect(wave.ready.map((r) => r.num)).toEqual([1, 3])
    expect(wave.waiting).toContainEqual({ num: 2, reason: { kind: 'files', files: ['src/b.ts'], heldBy: [1] } })
  })

  it('leaves out an open Ticket whose file is held by a Ticket in work', () => {
    const wave = readyWave([
      ticket(1, { state: 'work', statusRaw: 'claimed', files: ['src/shared.ts'] }),
      ticket(2, { files: ['src/shared.ts', 'src/own.ts'] }),
      ticket(3, { files: ['src/free.ts'] }),
    ])
    expect(wave.ready.map((r) => r.num)).toEqual([3])
    expect(wave.waiting).toContainEqual({ num: 2, reason: { kind: 'files', files: ['src/shared.ts'], heldBy: [1] } })
  })

  it('holds the files of a Ticket claimed only in a worktree branch', () => {
    const wave = readyWave([
      ticket(1, { state: 'work', statusRaw: 'claimed — 2026-10-05', fromBranch: 'e/01', files: ['src/x.ts'] }),
      ticket(2, { files: ['src/x.ts'] }),
    ])
    expect(wave.ready).toEqual([])
  })

  it('treats a directory entry as holding every file under it', () => {
    const wave = readyWave([ticket(1, { files: ['test/fixtures/epic/'] }), ticket(2, { files: ['test/fixtures/epic/spec.md'] })])
    expect(wave.ready.map((r) => r.num)).toEqual([1])
  })

  it('takes a Ticket without a "Где в коде" section and marks it', () => {
    const wave = readyWave([ticket(1, { files: [], filesListed: false }), ticket(2)])
    expect(wave.ready).toEqual([
      { num: 1, filesNotListed: true },
      { num: 2, filesNotListed: false },
    ])
  })

  it('reports a cycle, an unparsed blocker and a missing blocker as reasons, without throwing', () => {
    const wave = readyWave([
      ticket(1, blocked(2)),
      ticket(2, blocked(1)),
      ticket(3, { blockedParsed: false, blockedRaw: '???', blockedNums: [] }),
      ticket(4, blocked(42)),
      ticket(5),
    ])
    expect(wave.ready.map((r) => r.num)).toEqual([5])
    expect(wave.waiting).toEqual([
      { num: 1, reason: { kind: 'cycle', cycle: [1, 2] } },
      { num: 2, reason: { kind: 'cycle', cycle: [1, 2] } },
      { num: 3, reason: { kind: 'unparsed', raw: '???' } },
      { num: 4, reason: { kind: 'missing-blocker', missing: [42] } },
    ])
  })

  it('lists as skipped the blocked and status-less Tickets whose blockers are all done, and nothing in work or done (ticket 30)', () => {
    const wave = readyWave([
      ticket(1, { state: 'done', statusRaw: 'done' }),
      ticket(2, { ...blocked(1), state: 'blocked', statusRaw: 'blocked — rejected' }),
      ticket(3, { state: 'none', statusRaw: null }),
      ticket(4, { ...blocked(5), state: 'blocked', statusRaw: 'blocked' }),
      ticket(5),
      ticket(6, { state: 'work', statusRaw: 'claimed' }),
      ticket(7, { ...blocked(1), state: 'done', statusRaw: 'done' }),
      ticket(8, { state: 'blocked', statusRaw: 'blocked', blockedParsed: false, blockedRaw: '???', blockedNums: [] }),
    ])
    expect(wave.ready.map((r) => r.num)).toEqual([5])
    // 4 waits for 5, 8 has a "Blocked by" that is not a list: neither is skipped for its state alone.
    expect(wave.skipped).toEqual([
      { num: 2, state: 'blocked' },
      { num: 3, state: 'none' },
    ])
  })

  it('has no skipped Tickets when every Ticket not done is open', () => {
    expect(readyWave([ticket(1), ticket(2, blocked(1))]).skipped).toEqual([])
  })

  describe('a blocker done only in its worktree branch, not yet merged', () => {
    const doneInBranch = (num: number, over: Partial<Ticket> = {}) => ticket(num, { state: 'done', statusRaw: 'done', fromBranch: `e/0${num}`, ...over })

    it('does not close the blocker: the dependant waits for it, as for a blocker not done', () => {
      const wave = readyWave([doneInBranch(1), ticket(2, blocked(1))])
      expect(wave.ready).toEqual([])
      expect(wave.waiting).toEqual([{ num: 2, reason: { kind: 'blockers', blockers: [1] } }])
    })

    it('closes the same blocker once its done comes from the checkout', () => {
      const wave = readyWave([doneInBranch(1, { fromBranch: null }), ticket(2, blocked(1))])
      expect(wave.ready.map((r) => r.num)).toEqual([2])
      expect(wave.waiting).toEqual([])
    })

    it('checks every blocker, not only the first one', () => {
      const wave = readyWave([ticket(1, { state: 'done', statusRaw: 'done' }), doneInBranch(2), ticket(3, blocked(1, 2))])
      expect(wave.waiting).toEqual([{ num: 3, reason: { kind: 'blockers', blockers: [2] } }])
    })

    it('holds its files: a Ticket sharing a file waits for it by files', () => {
      const wave = readyWave([doneInBranch(1, { files: ['src/shared.ts'] }), ticket(2, { files: ['src/shared.ts', 'src/own.ts'] }), ticket(3, { files: ['src/free.ts'] })])
      expect(wave.ready.map((r) => r.num)).toEqual([3])
      expect(wave.waiting).toEqual([{ num: 2, reason: { kind: 'files', files: ['src/shared.ts'], heldBy: [1] } }])
    })

    it('does not hold the files of a Ticket done in the checkout', () => {
      const wave = readyWave([ticket(1, { state: 'done', statusRaw: 'done', files: ['src/shared.ts'] }), ticket(2, { files: ['src/shared.ts'] })])
      expect(wave.ready.map((r) => r.num)).toEqual([2])
      expect(wave.waiting).toEqual([])
    })

    it('does not list as skipped a blocked Ticket whose only blocker is done in a branch', () => {
      const wave = readyWave([doneInBranch(1), ticket(2, { ...blocked(1), state: 'blocked', statusRaw: 'blocked' })])
      expect(wave.skipped).toEqual([])
    })

    it('reads a Ticket without the fromBranch field as one from the checkout', () => {
      const one: Omit<Ticket, 'fromBranch'> & { fromBranch?: string | null } = ticket(1, { state: 'done', statusRaw: 'done', files: ['src/shared.ts'] })
      delete one.fromBranch
      expect('fromBranch' in one).toBe(false)
      const wave = readyWave([one, ticket(2, blocked(1)), ticket(3, { files: ['src/shared.ts'] })])
      expect(wave.ready.map((r) => r.num)).toEqual([2, 3])
    })

    it('is not named by "Run wave" nor started by Autopilot', () => {
      const tickets = [doneInBranch(1), ticket(2, blocked(1)), ticket(3)]
      expect(runWaveState({ epic: 'e', tickets, template: DEFAULT_ACTION_TEMPLATES.runWave, branch: 'main' })).toMatchObject({ enabled: true, tickets: [3] })
      expect(runWaveState({ epic: 'e', tickets: tickets.slice(0, 2), template: DEFAULT_ACTION_TEMPLATES.runWave, branch: 'main' })).toEqual({ enabled: false, reason: 'No ready wave' })
      expect(step(initialCycle('e'), { type: 'start', tickets: tickets.slice(0, 2) }).effects).toEqual([{ kind: 'stopped', reason: 'no-ready-wave' }])
      const merged = [doneInBranch(1, { fromBranch: null }), ticket(2, blocked(1))]
      expect(step(initialCycle('e'), { type: 'start', tickets: merged }).effects).toEqual([{ kind: 'send-wave' }])
    })
  })
})

describe('wave numbers', () => {
  it('repeats the ready-wave step until nothing is left, done Tickets get no number', () => {
    const waves = waveNumbers([
      ticket(1, { state: 'done', statusRaw: 'done' }),
      ticket(2, blocked(1)),
      ticket(3, { ...blocked(2), files: ['src/t2.ts'] }),
      ticket(4, { files: ['src/t2.ts'] }),
      ticket(5, blocked(3)),
    ])
    // 4 shares src/t2.ts with 2 and then with 3, which comes first by number in wave 2.
    expect(Object.fromEntries(waves)).toEqual({ 2: 1, 3: 2, 4: 3, 5: 3 })
  })

  it('leaves a Ticket in work out of the numbering but lets dependants follow it', () => {
    const waves = waveNumbers([ticket(1, { state: 'work', statusRaw: 'claimed' }), ticket(2, blocked(1)), ticket(3)])
    expect(Object.fromEntries(waves)).toEqual({ 3: 1, 2: 2 })
  })

  it('numbers the dependants of a Ticket done only in a branch after it, as after a Ticket in work', () => {
    const waves = waveNumbers([
      ticket(1, { state: 'done', statusRaw: 'done', fromBranch: 'e/01' }),
      ticket(2, blocked(1)),
      ticket(3),
      ticket(4, { files: ['src/t1.ts'] }),
    ])
    // 2 waits for the merge of 1, 4 for its file; 1 itself gets no number, like a Ticket in work.
    expect(Object.fromEntries(waves)).toEqual({ 3: 1, 2: 2, 4: 2 })
    expect(Object.fromEntries(waveNumbers([ticket(1, { state: 'done', statusRaw: 'done', fromBranch: 'e/01' }), ticket(2, blocked(1))]))).toEqual({ 2: 1 })
  })

  it('does not spend a number on a round where only Tickets in work move', () => {
    // 2 shares src/t1.ts with 1, which is in work: nothing is ready now, so 2 is the first wave.
    const waves = waveNumbers([ticket(1, { state: 'work', statusRaw: 'claimed' }), ticket(2, { files: ['src/t1.ts'] })])
    expect(Object.fromEntries(waves)).toEqual({ 2: 1 })
  })

  it('gives no number to Tickets behind a cycle or an unparsed blocker', () => {
    const waves = waveNumbers([ticket(1, blocked(2)), ticket(2, blocked(1)), ticket(3, blocked(1)), ticket(4)])
    expect(Object.fromEntries(waves)).toEqual({ 4: 1 })
  })
})
