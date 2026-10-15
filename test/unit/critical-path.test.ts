// scripts/critical-path.mjs: how long each Ticket waited on each step — claim → PR → CI → Gate →
// merge — read from Autopilot journals, Ticket files and PR data that are already there. The
// fixture (test/fixtures/critical-path/) is one run of `demo-epic` with a Limits wait, a cut-off
// line, a line of an unknown kind, a session error and a stop, one run of `other-epic` that ends
// while it waits, Ticket files with Status lines, and the PR data `gh` would give.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { JOURNAL_EVENT_KINDS } from '../../src/shared/autopilot/journal'
import { removeTestTree } from '../remove'

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'critical-path.mjs')
const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'critical-path')
const JOURNALS = join(FIXTURE, 'journals')
const ROOT = join(FIXTURE, 'project')
const PRS = join(FIXTURE, 'prs.json')
const DEMO = ['--journals', JOURNALS, '--root', ROOT, '--epic', 'demo-epic', '--prs', PRS]

interface GhResult {
  code: number | null
  stdout: string
  stderr: string
  missing?: boolean
}
interface Deps {
  env: Record<string, string | undefined>
  home: string
  cwd: string
  gh: (args: string[], cwd: string) => Promise<GhResult>
  out: (text: string) => void
  err: (line: string) => void
}
interface CriticalPath {
  criticalPath: (args: string[], deps: Deps) => Promise<number>
  journalsFolder: (env: Record<string, string | undefined>, home: string) => string
  JOURNAL_KINDS: readonly string[]
}
const { criticalPath, journalsFolder, JOURNAL_KINDS } = (await import(pathToFileURL(SCRIPT).href)) as CriticalPath

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-critical-path-')))
  dirs.push(dir)
  return dir
}

/** Runs the script as `pnpm test` runs it: under Electron as Node; `env` replaces the given keys. */
function run(args: string[], env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env } })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/** RFC 4180 rows of a CSV text, as objects by the header's names. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  const [header = [], ...body] = rows
  return body.map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])))
}

function csvRows(args: string[]): Record<string, string>[] {
  const { status, stdout, stderr } = run([...args, '--csv'])
  expect(stderr).toBe('')
  expect(status).toBe(0)
  return parseCsv(stdout)
}

const rowOf = (rows: Record<string, string>[], epic: string, ticket: string): Record<string, string> => {
  const row = rows.find((r) => r.epic === epic && r.ticket === ticket)
  if (row === undefined) throw new Error(`no row ${epic}/${ticket}`)
  return row
}

/** Every file under `dir` with its size and modification time. */
function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>()
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) walk(path)
      else {
        const stat = statSync(path)
        files.set(relative(dir, path), `${stat.size} ${stat.mtimeMs}`)
      }
    }
  }
  walk(dir)
  return files
}

/** A copy of the fixture in a temporary folder laid out as on a machine: a home, a worfy data folder, a Project. */
function machine(): { dir: string; home: string; data: string; root: string; prs: string; env: Record<string, string> } {
  const dir = tempDir()
  const home = join(dir, 'home')
  const data = join(dir, 'data')
  mkdirSync(join(home, '.claude'), { recursive: true })
  cpSync(JOURNALS, join(data, 'autopilot'), { recursive: true })
  cpSync(ROOT, join(dir, 'project'), { recursive: true })
  cpSync(PRS, join(dir, 'prs.json'))
  // An empty PATH: no `gh` can be found, so nothing reaches the network.
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  return { dir, home, data, root: join(dir, 'project'), prs: join(dir, 'prs.json'), env: { HOME: home, USERPROFILE: home, WORFY_DATA_DIR: data, PATH: bin } }
}

describe('critical-path: durations of each step', () => {
  it('measures claim → PR → CI → Gate → merge and the total of a Ticket the Autopilot ran', () => {
    const row = rowOf(csvRows(DEMO), 'demo-epic', '01')
    expect(row).toMatchObject({ status: 'done', pr: '11', start: '2026-10-06T01:00:00.000Z', start_source: 'wave-started' })
    expect(row).toMatchObject({ claim_to_pr_s: '2400', pr_to_ci_s: '3300', ci_to_gate_s: '900', gate_to_merge_s: '600', total_s: '7200' })
    expect([row.claim_to_pr_why, row.pr_to_ci_why, row.ci_to_gate_why, row.gate_to_merge_why, row.total_why]).toEqual(['', '', '', '', ''])
  })

  it('takes CI green at the last successful run of the branch before the Gate, not a manual run or a rerun after it', () => {
    // PR #11's runs: failed 01:50, green 02:35, manual 02:45, green again 02:58 after the Gate's 02:50.
    const row = rowOf(csvRows(DEMO), 'demo-epic', '01')
    expect(row).toMatchObject({ pr_to_ci_s: '3300', ci_to_gate_s: '900' })
  })

  it('starts a Ticket without Autopilot at the first commit of its PR, found by the number in its Status', () => {
    const row = rowOf(csvRows(DEMO), 'demo-epic', '04')
    // PR #13 has the branch name demo-epic/04 but is closed; the Status names #14.
    expect(row).toMatchObject({ pr: '14', start: '2026-10-07T09:00:00.000Z', start_source: 'first commit' })
    // CI: the latest check to finish, StatusContext and CheckRun alike.
    expect(row).toMatchObject({ claim_to_pr_s: '3600', pr_to_ci_s: '4200', ci_to_gate_s: '600', gate_to_merge_s: '1200', total_s: '9600' })
  })

  it('leaves a step without data empty with the reason, never zero', () => {
    const rows = csvRows(DEMO)
    const open = rowOf(rows, 'demo-epic', '02')
    expect(open).toMatchObject({ claim_to_pr_s: '3600', pr_to_ci_s: '', pr_to_ci_why: 'no CI checks on the PR' })
    expect(open).toMatchObject({ ci_to_gate_s: '', ci_to_gate_why: 'no CI checks on the PR' })
    expect(open).toMatchObject({ gate_to_merge_s: '', gate_to_merge_why: 'no VERIFIED comment on the PR', total_s: '', total_why: 'PR not merged (OPEN)' })
    const noPr = rowOf(rows, 'demo-epic', '03')
    expect(noPr).toMatchObject({ pr: '', claim_to_pr_s: '', claim_to_pr_why: 'no PR for demo-epic/03 in the PR file', total_s: '' })
    expect(noPr).toMatchObject({ rework_rounds: '', rework_why: 'no PR for demo-epic/03 in the PR file' })
    const claimed = rowOf(rows, 'demo-epic', '05')
    expect(claimed).toMatchObject({ start: '', start_source: '', claim_to_pr_s: '', claim_to_pr_why: 'claim date only (2026-10-07), no time' })
  })

  it('prints an empty cell as a dash with its reason in Markdown', () => {
    const { status, stdout } = run(DEMO)
    expect(status).toBe(0)
    const line = stdout.split('\n').find((l) => l.startsWith('| 02 |'))
    expect(line).toContain('| 1 h 00 min |')
    expect(line).toContain('— (no CI checks on the PR)')
    expect(line).toContain('— (PR not merged (OPEN))')
    expect(line).not.toMatch(/\| 0 s \|/)
  })

  it('counts the Limits wait from limits-hit to resumed for each Ticket of the Wave, with offsets in at', () => {
    const rows = csvRows(DEMO)
    for (const ticket of ['01', '02', '03']) expect(rowOf(rows, 'demo-epic', ticket)).toMatchObject({ limits_wait_s: '1800', limits_wait_why: '' })
    expect(rowOf(rows, 'demo-epic', '04')).toMatchObject({ limits_wait_s: '', limits_wait_why: 'not run by Autopilot (no wave-started)' })
  })

  it('leaves the Limits wait empty when the journal ends while the run waits', () => {
    const row = rowOf(csvRows(['--journals', JOURNALS, '--prs', PRS]), 'other-epic', '01')
    expect(row).toMatchObject({ limits_wait_s: '', limits_wait_why: 'a wait has no end in the journal' })
    const { stdout } = run(['--journals', JOURNALS, '--prs', PRS, '--epic', 'other-epic'])
    expect(stdout).toContain('Limits wait in the runs of this Epic: 0 s and a wait with no end in the journal.')
    expect(run(DEMO).stdout).toContain('Limits wait in the runs of this Epic: 30 min. Rework rounds: 1. Narrow rounds: 1. Stops: 4.')
  })

  it('counts rework rounds from REJECTED comments, narrow rounds from NARROW comments, and stops of the run', () => {
    const rows = csvRows(DEMO)
    expect(rowOf(rows, 'demo-epic', '01')).toMatchObject({ rework_rounds: '1', narrow_rounds: '1', stops: '1', stop_reasons: 'session-error' })
    expect(rowOf(rows, 'demo-epic', '02')).toMatchObject({ rework_rounds: '0', narrow_rounds: '0', stops: '1' })
    expect(rowOf(rows, 'demo-epic', '03')).toMatchObject({ stops: '2', stop_reasons: 'session-error; run-stopped: no-progress' })
    expect(rowOf(rows, 'demo-epic', '04')).toMatchObject({ stops: '', stops_why: 'not run by Autopilot (no wave-started)' })
  })

  it('takes narrow rounds from the journal when there is no PR', () => {
    const m = machine()
    const empty = join(m.dir, 'none.json')
    writeFileSync(empty, '[]\n')
    const rows = csvRows(['--journals', JOURNALS, '--root', ROOT, '--epic', 'demo-epic', '--prs', empty])
    expect(rowOf(rows, 'demo-epic', '01')).toMatchObject({ narrow_rounds: '1', narrow_why: '', rework_rounds: '', rework_why: 'no PR for demo-epic/01 in the PR file' })
    expect(rowOf(rows, 'demo-epic', '02')).toMatchObject({ narrow_rounds: '0', narrow_why: '' })
    expect(rowOf(rows, 'demo-epic', '04')).toMatchObject({ narrow_rounds: '', narrow_why: 'no PR for demo-epic/04 in the PR file' })
  })
})

describe('critical-path: the summary of an Epic', () => {
  it('sums and takes the median of each step and names the critical step by both', () => {
    const rows = csvRows(DEMO)
    expect(rowOf(rows, 'demo-epic', 'sum')).toMatchObject({ claim_to_pr_s: '9600', pr_to_ci_s: '7500', ci_to_gate_s: '1500', gate_to_merge_s: '1800', total_s: '16800', limits_wait_s: '5400' })
    expect(rowOf(rows, 'demo-epic', 'median')).toMatchObject({ claim_to_pr_s: '3600', pr_to_ci_s: '3750', ci_to_gate_s: '750', gate_to_merge_s: '900', total_s: '8400', limits_wait_s: '1800' })
    const { stdout } = run(DEMO)
    expect(stdout).toContain('Critical step: by sum — claim → PR (2 h 40 min); by median — PR → CI (1 h 03 min).')
    expect(stdout).toContain('| claim → PR | 3 of 5 | 2 h 40 min | 1 h 00 min |')
  })

  it('limits the report to the chosen Tickets', () => {
    const rows = csvRows([...DEMO, '--tickets', '01,04'])
    expect(rows.map((r) => r.ticket)).toEqual(['01', '04', 'sum', 'median'])
    expect(rowOf(rows, 'demo-epic', 'sum')).toMatchObject({ total_s: '16800' })
  })
})

describe('critical-path: what it reads from the journal', () => {
  it('skips and counts a cut-off line, a line of an unknown kind and a line whose fields do not match, and still builds the report', () => {
    const { status, stdout, stderr } = run(['--journals', JOURNALS, '--prs', PRS])
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toContain('Journals: 2 files, 16 lines read; skipped 3 (not JSON 1, unknown kind 1, fields do not match 1).')
    expect(stdout).toContain('## demo-epic')
    expect(stdout).toContain('## other-epic')
  })

  it('keeps the kinds it knows in step with the journal format', () => {
    expect([...JOURNAL_KINDS]).toEqual([...JOURNAL_EVENT_KINDS])
  })

  it('puts no message, answer, Wave text or path of the journal into the report', () => {
    for (const args of [DEMO, [...DEMO, '--csv']]) {
      const { stdout } = run(args)
      expect(stdout).not.toContain('/Users/someone')
      expect(stdout).not.toContain('spawn failed')
      expect(stdout).not.toContain("the Orchestrator's last answer")
      expect(stdout).not.toContain('Tickets 01, 02, 03 of epic')
      expect(stdout).not.toContain(FIXTURE)
      expect(stdout).not.toContain('the wait never ends')
    }
  })
})

describe('critical-path: the command line', () => {
  it('prints its input and output with --help', () => {
    const { status, stdout } = run(['--help'])
    expect(status).toBe(0)
    for (const word of ['--journals', '--root', '--epic', '--tickets', '--prs', '--repo', '--csv', '--out', 'WORFY_DATA_DIR', 'Windows', 'Markdown']) {
      expect(stdout).toContain(word)
    }
  })

  it('reports on the journals of the worfy data folder without arguments and exits 0', () => {
    const m = machine()
    const { status, stdout, stderr } = run([], m.env)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toContain('Journals: 2 files')
    expect(stdout).toContain('## demo-epic')
    expect(stdout).toContain('— (gh not available)')
  })

  it('takes the journals folder from --journals, else WORFY_DATA_DIR, else the macOS data folder', () => {
    expect(journalsFolder({ WORFY_DATA_DIR: 'data' }, '/home/u')).toBe(join(resolve('data'), 'autopilot'))
    expect(journalsFolder({}, '/Users/u')).toBe(posix.join('/Users/u', 'Library', 'Application Support', 'worfy', 'autopilot'))
  })

  it('refuses wrong arguments and a missing journals folder with exit 2', () => {
    expect(run(['--bogus'])).toMatchObject({ status: 2, stdout: '' })
    expect(run(['--epic'])).toMatchObject({ status: 2, stdout: '' })
    expect(run(['--epic', '../x'])).toMatchObject({ status: 2, stdout: '' })
    const missing = run(['--journals', join(tempDir(), 'nope')])
    expect(missing.status).toBe(2)
    expect(missing.stderr).toContain('no journals folder')
  })
})

describe('critical-path: it writes nothing but --out', () => {
  it('writes only the --out file; journals, Project, PR file, home and data folder stay as they were', () => {
    const m = machine()
    const before = snapshot(m.dir)
    const out = join(m.dir, 'reports', 'critical-path.md')
    mkdirSync(join(m.dir, 'reports'))
    const { status, stdout, stderr } = run(['--root', m.root, '--epic', 'demo-epic', '--prs', m.prs, '--out', out], m.env)
    expect(stderr).toBe('')
    expect(status).toBe(0)
    expect(stdout).toBe('')
    const after = snapshot(m.dir)
    expect([...after.keys()].filter((path) => !before.has(path))).toEqual([relative(m.dir, out)])
    for (const [path, stamp] of before) expect(after.get(path), path).toBe(stamp)
    expect(readFileSync(out, 'utf8')).toContain('## demo-epic')
  })

  it('writes nothing at all without --out', () => {
    const m = machine()
    const before = snapshot(m.dir)
    expect(run(['--root', m.root, '--prs', m.prs], m.env).status).toBe(0)
    expect(snapshot(m.dir)).toEqual(before)
  })

  it('refuses an --out inside the journals, the worfy data folder, the Project or ~/.claude', () => {
    const m = machine()
    const before = snapshot(m.dir)
    for (const out of [join(m.data, 'autopilot', 'r.md'), join(m.data, 'r.md'), join(m.root, 'r.md'), join(m.home, '.claude', 'r.md')]) {
      const { status, stderr } = run(['--root', m.root, '--prs', m.prs, '--out', out], m.env)
      expect(status, out).toBe(2)
      expect(stderr).toContain('refused')
      expect(existsSync(out)).toBe(false)
    }
    expect(snapshot(m.dir)).toEqual(before)
  })
})

describe('critical-path: --out spelled another way', () => {
  it('refuses an --out into ~/.claude or the data folder typed in another case on a case-insensitive disk', (context) => {
    const m = machine()
    // On a case-sensitive file system (Linux) `.CLAUDE` is another folder, which does not exist.
    if (!existsSync(join(m.home, '.CLAUDE')) || !existsSync(join(m.dir, 'DATA'))) context.skip('the file system tells case apart: another case is another folder')
    const before = snapshot(m.dir)
    for (const out of [join(m.home, '.CLAUDE', 'd.md'), join(m.dir, 'DATA', 'AutoPilot', 'e.md')]) {
      const { status, stderr } = run(['--root', m.root, '--prs', m.prs, '--out', out], m.env)
      expect(status, out).toBe(2)
      expect(stderr).toContain('refused')
    }
    expect(snapshot(m.dir)).toEqual(before)
  })

  it('refuses an --out that is a link to a file not yet there inside ~/.claude', (context) => {
    const m = machine()
    mkdirSync(join(m.dir, 'reports'))
    const target = join(m.home, '.claude', 'new.md')
    const link = join(m.dir, 'reports', 'link.md')
    try {
      symlinkSync(target, link)
    } catch (error) {
      context.skip(`this user cannot create a symlink: ${error instanceof Error ? error.message : String(error)}`)
    }
    const { status, stderr } = run(['--root', m.root, '--prs', m.prs, '--out', link], m.env)
    expect(status).toBe(2)
    expect(stderr).toContain('refused')
    expect(existsSync(target)).toBe(false)
  })
})

describe('critical-path: PR data through gh', () => {
  const prs = JSON.parse(readFileSync(PRS, 'utf8')) as { number: number; headRefName: string }[]

  async function report(gh: Deps['gh'], args: string[] = ['--journals', JOURNALS, '--root', ROOT, '--epic', 'demo-epic', '--csv']): Promise<{ code: number; text: string; err: string[] }> {
    let text = ''
    const err: string[] = []
    const code = await criticalPath(args, { env: {}, home: '/Users/someone', cwd: tempDir(), gh, out: (t) => (text += t), err: (l) => err.push(l) })
    return { code, text, err }
  }

  it('asks gh for the PR named in the Status, else for the branch <epic>/<NN>, in the repository of the run', async () => {
    const calls: string[][] = []
    const { code, text } = await report(async (args) => {
      calls.push(args)
      const number = args[0] === 'pr' && args[1] === 'view' ? Number(args[2]) : undefined
      const head = args.includes('--head') ? args[args.indexOf('--head') + 1] : undefined
      const found = prs.filter((pr) => pr.number === number || pr.headRefName === head)
      return { code: 0, stdout: JSON.stringify(number === undefined ? found : found[0]), stderr: '' }
    })
    expect(code).toBe(0)
    const fields = 'number,headRefName,state,createdAt,mergedAt,statusCheckRollup,comments,commits'
    expect(calls).toContainEqual(['pr', 'view', '11', '--repo', 'github.com/owner/demo', '--json', fields])
    expect(calls).toContainEqual(['pr', 'list', '--head', 'demo-epic/03', '--state', 'all', '--limit', '20', '--json', fields, '--repo', 'github.com/owner/demo'])
    expect(calls).toContainEqual(['run', 'list', '--branch', 'demo-epic/04-manual', '--limit', '100', '--json', 'status,conclusion,event,createdAt,updatedAt', '--repo', 'github.com/owner/demo'])
    const rows = parseCsv(text)
    expect(rowOf(rows, 'demo-epic', '01')).toMatchObject({ total_s: '7200' })
    expect(rowOf(rows, 'demo-epic', '02')).toMatchObject({ pr: '12', claim_to_pr_s: '3600' })
    expect(rowOf(rows, 'demo-epic', '03')).toMatchObject({ pr: '', claim_to_pr_why: 'no PR with the branch demo-epic/03' })
  })

  it('asks the repository of a later run of the same Project when the Epic’s runs name none', async () => {
    const journals = tempDir()
    cpSync(JOURNALS, journals, { recursive: true })
    const run = '2026-10-05T00-00-00-000Z-cccccc'
    const line = (at: string, kind: string, rest: object): string => JSON.stringify({ at, run, project: 'demo-1a2b3c4d', epic: 'old-epic', kind, ...rest })
    writeFileSync(join(journals, `${run}.jsonl`), [line('2026-10-05T00:00:00Z', 'run-started', {}), line('2026-10-05T00:00:01Z', 'wave-started', { wave: 1, tickets: ['01'] })].join('\n'))
    const calls: string[][] = []
    await report(async (args) => {
      calls.push(args)
      return { code: 0, stdout: '[]', stderr: '' }
    }, ['--journals', journals, '--epic', 'old-epic'])
    expect(calls).toEqual([['pr', 'list', '--head', 'old-epic/01', '--state', 'all', '--limit', '20', '--json', 'number,headRefName,state,createdAt,mergedAt,statusCheckRollup,comments,commits', '--repo', 'github.com/owner/demo']])
  })

  it('leaves the PR steps empty with gh’s reason, home folder hidden, when gh fails or is missing', async () => {
    const failed = await report(async () => ({ code: 1, stdout: '', stderr: 'could not read /Users/someone/.config/gh/hosts.yml\nmore' }))
    expect(failed.code).toBe(0)
    expect(rowOf(parseCsv(failed.text), 'demo-epic', '01')).toMatchObject({ claim_to_pr_s: '', claim_to_pr_why: 'gh failed: could not read ~/.config/gh/hosts.yml' })
    const missing = await report(async () => ({ code: null, stdout: '', stderr: '', missing: true }))
    expect(rowOf(parseCsv(missing.text), 'demo-epic', '01')).toMatchObject({ claim_to_pr_why: 'gh not available' })
  })

  it('leaves a step empty as out of order when its end comes before its start', async () => {
    const pr = {
      number: 21,
      headRefName: 'demo-epic/01',
      state: 'MERGED',
      createdAt: '2026-10-06T01:40:00Z',
      mergedAt: '2026-10-06T03:00:00Z',
      commits: [],
      statusCheckRollup: [{ __typename: 'CheckRun', name: 'check', status: 'COMPLETED', conclusion: 'SUCCESS', completedAt: '2026-10-06T02:40:00Z' }],
      comments: [{ createdAt: '2026-10-06T02:30:00Z', body: 'VERIFIED' }],
    }
    const { text } = await report(async () => ({ code: 0, stdout: JSON.stringify(pr), stderr: '' }), ['--journals', JOURNALS, '--root', ROOT, '--epic', 'demo-epic', '--tickets', '01', '--csv'])
    expect(rowOf(parseCsv(text), 'demo-epic', '01')).toMatchObject({ pr_to_ci_s: '3600', ci_to_gate_s: '', ci_to_gate_why: 'out of order: Gate before CI', gate_to_merge_s: '1800', total_s: '7200' })
  })

  it('counts NARROW: REJECTED as the verdict of the narrow round, not as a rework round', async () => {
    const pr = (bodies: string[]) => ({
      number: 11,
      headRefName: 'demo-epic/01',
      state: 'MERGED',
      createdAt: '2026-10-06T01:40:00Z',
      mergedAt: '2026-10-06T03:00:00Z',
      commits: [],
      statusCheckRollup: [],
      comments: bodies.map((body, i) => ({ createdAt: `2026-10-06T02:0${i}:00Z`, body })),
    })
    const args = ['--journals', JOURNALS, '--root', ROOT, '--epic', 'demo-epic', '--tickets', '01', '--csv']
    const rows = async (bodies: string[]) => rowOf(parseCsv((await report(async () => ({ code: 0, stdout: JSON.stringify(pr(bodies)), stderr: '' }), args)).text), 'demo-epic', '01')
    expect(await rows(['REJECTED: [med] a', 'NARROW: [med] b', 'NARROW: REJECTED c', 'VERIFIED'])).toMatchObject({ rework_rounds: '1', narrow_rounds: '1', gate_to_merge_s: '3420' })
    expect(await rows(['NARROW: REJECTED c'])).toMatchObject({ rework_rounds: '0', narrow_rounds: '1' })
    expect(await rows(['NARROW: VERIFIED d'])).toMatchObject({ rework_rounds: '0', narrow_rounds: '1', gate_to_merge_s: '3600' })
  })

  it('reads a failed and an unfinished CI as not green', async () => {
    const pr = (conclusion: string | null, status: string) => ({
      number: 11,
      headRefName: 'demo-epic/01',
      state: 'OPEN',
      createdAt: '2026-10-06T01:40:00Z',
      mergedAt: null,
      commits: [],
      statusCheckRollup: [{ __typename: 'CheckRun', name: 'check', status, conclusion, completedAt: conclusion ? '2026-10-06T02:40:00Z' : null }],
      comments: [],
    })
    const args = ['--journals', JOURNALS, '--root', ROOT, '--epic', 'demo-epic', '--tickets', '01', '--csv']
    const failed = await report(async () => ({ code: 0, stdout: JSON.stringify(pr('FAILURE', 'COMPLETED')), stderr: '' }), args)
    expect(rowOf(parseCsv(failed.text), 'demo-epic', '01')).toMatchObject({ pr_to_ci_s: '', pr_to_ci_why: 'CI not green (check: FAILURE)' })
    const running = await report(async () => ({ code: 0, stdout: JSON.stringify(pr(null, 'IN_PROGRESS')), stderr: '' }), args)
    expect(rowOf(parseCsv(running.text), 'demo-epic', '01')).toMatchObject({ pr_to_ci_s: '', pr_to_ci_why: 'CI not finished (check)' })
    const failedRuns = [{ status: 'completed', conclusion: 'failure', event: 'pull_request', updatedAt: '2026-10-06T02:00:00Z' }]
    const noGreenRun = await report(async (call) => ({ code: 0, stdout: JSON.stringify(call[0] === 'run' ? failedRuns : pr('SUCCESS', 'COMPLETED')), stderr: '' }), args)
    expect(rowOf(parseCsv(noGreenRun.text), 'demo-epic', '01')).toMatchObject({ pr_to_ci_s: '', pr_to_ci_why: 'CI not green (no successful run)' })
  })
})
