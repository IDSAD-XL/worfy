// The gate queue as worfy reads it (worfy-windows ticket 17, src/main/github/gate-queue.ts): the role of this
// Machine from the Profile's cross_machine_gate, the open PRs with its label from one `gh pr list` as the
// Project's GitHub account, and rule 1 — the PRs that wait for the machine with `serve`. bin/profile and gh are
// functions here: no script, no gh and no network run.
import { describe, expect, it } from 'vitest'
import { GATE_QUEUE_INTERVAL_MS, GateQueueReader, waitingPrs, type QueuePr } from '../../src/main/github/gate-queue'
import type { GhEnv } from '../../src/main/github/prs'
import type { ProfileRun } from '../../src/main/workflow/profile'

const ROOT = '/repo/worfy'
const GATE = { role: 'serve', label: 'needs-mac-gate', checks_section: 'Mac checks', check: 'gate full', exempt: ['docs/'] }
const RED = 'Mac checks report: red\nreason: pnpm icons exit 1'

const comment = (login: string, createdAt: string, body: string) => ({ author: { login }, createdAt, body })
function pr(number: number, createdAt: string, committedDate: string, comments: ReturnType<typeof comment>[] = []): QueuePr {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    createdAt,
    commits: [{ oid: `old${number}`, committedDate: '2026-10-18T05:00:00Z' }, { oid: `oid${number}`, committedDate }],
    comments,
  }
}
// The three PRs of the skill's test (harness/bin/tests/gate-queue.test.sh): #21 without a report; #22 with a red
// report newer than its last commit; #23 with the same report older than its last commit.
const THREE = [
  pr(21, '2026-10-18T08:00:00Z', '2026-10-18T07:00:00Z'),
  pr(22, '2026-10-18T06:00:00Z', '2026-10-18T09:00:00Z', [comment('mac-bot', '2026-10-18T10:00:00Z', RED)]),
  pr(23, '2026-10-18T06:00:00Z', '2026-10-18T07:30:00Z', [comment('mac-bot', '2026-10-18T07:00:00Z', RED)]),
]
const NOW = Date.parse('2026-10-18T12:00:00Z')

describe('rule 1: the PRs that wait for the machine with serve', () => {
  it('takes the PR without a report and the one whose report is older than its last commit, the older wait first', () => {
    const waiting = waitingPrs(THREE, 'Mac checks', 'mac-bot', NOW)
    expect(waiting.map((each) => each.number)).toEqual([23, 21])
    expect(waiting[0]).toMatchObject({ since: '2026-10-18T07:30:00Z', lastCommit: 'oid23', waitedMs: 4.5 * 3_600_000, title: 'PR 23', url: 'https://github.com/o/r/pull/23' })
    // #21 was created after its last commit: the wait counts from the creation.
    expect(waiting[1]).toMatchObject({ since: '2026-10-18T08:00:00Z', lastCommit: 'oid21' })
  })

  it('counts only a report by the GitHub account, only a comment that starts with the report line, a green report too', () => {
    const prs = [
      pr(31, '2026-10-18T06:00:00Z', '2026-10-18T05:30:00Z', [comment('mallory', '2026-10-18T07:00:00Z', RED)]),
      pr(32, '2026-10-18T06:00:00Z', '2026-10-18T06:30:00Z', [comment('mac-bot', '2026-10-18T07:00:00Z', 'See the Mac checks report: red above')]),
      pr(33, '2026-10-18T06:00:00Z', '2026-10-18T09:00:00Z', [comment('mac-bot', '2026-10-18T09:30:00Z', 'Mac checks report: green\nall fine')]),
    ]
    expect(waitingPrs(prs, 'Mac checks', 'mac-bot', NOW).map((each) => each.number)).toEqual([31, 32])
    // Without an account no report counts: every labelled PR waits.
    expect(waitingPrs(THREE, 'Mac checks', null, NOW).map((each) => each.number)).toEqual([23, 21, 22])
  })

  it('a PR without commits waits since its creation; a PR whose time cannot be read is left out', () => {
    const empty = { ...pr(41, '2026-10-18T06:00:00Z', '2026-10-18T05:00:00Z'), commits: [] }
    const broken = { ...pr(42, 'yesterday', '2026-10-18T05:00:00Z'), commits: [] }
    expect(waitingPrs([empty, broken], 'Mac checks', 'mac-bot', NOW)).toEqual([
      { number: 41, title: 'PR 41', url: 'https://github.com/o/r/pull/41', since: '2026-10-18T06:00:00Z', lastCommit: null, waitedMs: 6 * 3_600_000 },
    ])
  })
})

interface Harness {
  reader: GateQueueReader
  gh: { args: readonly string[]; cwd: string; env: GhEnv | undefined }[]
  profile: (readonly string[])[]
  logs: string[]
  wait(ms: number): void
}

/** A reader over a fake bin/profile (`gate`: the printed cross_machine_gate, or an exit code) and a fake gh. */
function harness(gate: unknown, options: { ghFails?: () => boolean; account?: string | null } = {}): Harness {
  let now = NOW
  const gh: Harness['gh'] = []
  const profile: Harness['profile'] = []
  const logs: string[] = []
  const answer = (code: number, stdout = ''): ProfileRun => ({ code, stdout, stderr: code === 0 ? '' : 'profile: no such field' })
  const reader = new GateQueueReader({
    claudeHome: '/home/.claude',
    env: () => Promise.resolve({ PATH: '/bin' }),
    now: () => now,
    log: (line) => logs.push(line),
    profile: (cwd, args) => {
      profile.push(args)
      expect(cwd).toBe(ROOT)
      const field = args[args.indexOf('--field') + 1]
      if (field === 'cross_machine_gate') return Promise.resolve(typeof gate === 'number' ? answer(gate) : answer(0, `${JSON.stringify(gate)}\n`))
      if (field === 'github.account') return Promise.resolve(options.account === null ? answer(4) : answer(0, `${options.account ?? 'mac-bot'}\n`))
      return Promise.resolve(answer(4))
    },
    run: (args, cwd, env) => {
      gh.push({ args, cwd, env })
      if (args[0] === 'auth') return Promise.resolve('gho_mac_token\n')
      if (options.ghFails?.() === true) return Promise.reject(new Error('HTTP 502: Bad Gateway (https://api.github.com/graphql)'))
      return Promise.resolve(JSON.stringify(THREE))
    },
  })
  return {
    reader,
    gh,
    profile,
    logs,
    wait: (ms) => {
      now += ms
    },
  }
}

const prLists = (h: Harness) => h.gh.filter((call) => call.args[0] === 'pr')

describe('the read of the queue', () => {
  it('a Profile without cross_machine_gate (exit code 4): no role, gh is not called, the reason is logged', async () => {
    const h = harness(4)
    const read = await h.reader.read(ROOT)
    expect(read.role).toBeNull()
    expect(read.label).toBeNull()
    expect(read.waiting).toEqual([])
    expect(read.gh).toEqual({ state: 'skipped', reason: expect.stringContaining('cross_machine_gate') })
    expect(h.gh).toEqual([])
    expect(h.logs.join('\n')).toContain('cross_machine_gate')
    expect(await h.reader.role(ROOT)).toBeNull()
  })

  it.each([
    ['a null field', null],
    ['an unknown role', { ...GATE, role: 'merge' }],
    ['a label gh would read as an option', { ...GATE, label: '--repo' }],
    ['a broken Profile (exit code 1)', 1],
  ])('%s: no role, gh is not called', async (_name, gate) => {
    const h = harness(gate)
    expect((await h.reader.read(ROOT)).role).toBeNull()
    expect(h.gh).toEqual([])
  })

  it('serve: one gh pr list with the label, as the Project\'s account, and rule 1 on the three PRs', async () => {
    const h = harness(GATE)
    const read = await h.reader.read(ROOT)
    expect(read.role).toBe('serve')
    expect(read.label).toBe('needs-mac-gate')
    expect(read.gh).toEqual({ state: 'ok' })
    expect(read.waiting.map((each) => [each.number, each.since])).toEqual([
      [23, '2026-10-18T07:30:00Z'],
      [21, '2026-10-18T08:00:00Z'],
    ])
    expect(prLists(h)).toEqual([
      {
        args: ['pr', 'list', '--state', 'open', '--label', 'needs-mac-gate', '--limit', '100', '--json', 'number,title,url,createdAt,commits,comments'],
        cwd: ROOT,
        env: { GH_TOKEN: 'gho_mac_token' },
      },
    ])
    // Read-only: the token of the account, the list, nothing else.
    expect(h.gh.map((call) => call.args.slice(0, 2).join(' '))).toEqual(['auth token', 'pr list'])
    expect(h.gh[0]?.args).toEqual(['auth', 'token', '-u', 'mac-bot'])
  })

  it('request: the same read, the role is request', async () => {
    const h = harness({ ...GATE, role: 'request' })
    const read = await h.reader.read(ROOT)
    expect(read.role).toBe('request')
    expect(read.waiting.map((each) => each.number)).toEqual([23, 21])
    expect(await h.reader.role(ROOT)).toBe('request')
  })

  it('reads once per 5 minutes; gh failing gives the reason and the next read 10 minutes later; a success brings back 5', async () => {
    let fails = false
    const h = harness(GATE, { ghFails: () => fails })
    await h.reader.read(ROOT)
    h.wait(GATE_QUEUE_INTERVAL_MS - 1)
    await h.reader.read(ROOT)
    expect(prLists(h)).toHaveLength(1)
    h.wait(1)
    fails = true
    const failed = await h.reader.read(ROOT)
    expect(prLists(h)).toHaveLength(2)
    expect(failed.gh).toEqual({ state: 'failed', reason: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)' })
    expect(failed.waiting).toEqual([])
    expect(failed.role).toBe('serve')
    // 5 minutes later: still the failed answer, gh not called.
    h.wait(GATE_QUEUE_INTERVAL_MS)
    expect((await h.reader.read(ROOT)).gh.state).toBe('failed')
    expect(prLists(h)).toHaveLength(2)
    // 10 minutes after the failure: read again; it fails again, so 20 minutes now.
    h.wait(GATE_QUEUE_INTERVAL_MS)
    await h.reader.read(ROOT)
    expect(prLists(h)).toHaveLength(3)
    h.wait(2 * GATE_QUEUE_INTERVAL_MS)
    await h.reader.read(ROOT)
    expect(prLists(h)).toHaveLength(3)
    h.wait(2 * GATE_QUEUE_INTERVAL_MS)
    fails = false
    expect((await h.reader.read(ROOT)).gh).toEqual({ state: 'ok' })
    expect(prLists(h)).toHaveLength(4)
    h.wait(GATE_QUEUE_INTERVAL_MS)
    await h.reader.read(ROOT)
    expect(prLists(h)).toHaveLength(5)
  })

  it('the interval doubles up to 30 minutes and no further', async () => {
    const h = harness(GATE, { ghFails: () => true })
    const gaps: number[] = []
    let last = 0
    for (let minute = 0; minute <= 200; minute += 1) {
      await h.reader.read(ROOT)
      if (prLists(h).length > last) {
        last = prLists(h).length
        gaps.push(minute)
      }
      h.wait(60_000)
    }
    const diffs = gaps.slice(1).map((at, index) => at - gaps[index]!)
    expect(diffs.slice(0, 4)).toEqual([10, 20, 30, 30])
  })

  it('role() reads the Profile again and never calls gh', async () => {
    const h = harness(GATE)
    expect(await h.reader.role(ROOT)).toBe('serve')
    expect(await h.reader.role(ROOT)).toBe('serve')
    expect(h.profile.filter((args) => args.includes('cross_machine_gate'))).toHaveLength(2)
    expect(h.gh).toEqual([])
  })

  it('two reads at once run gh once', async () => {
    const h = harness(GATE)
    const [a, b] = await Promise.all([h.reader.read(ROOT), h.reader.read(ROOT)])
    expect(a).toBe(b)
    expect(prLists(h)).toHaveLength(1)
  })
})
