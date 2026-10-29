// scripts/e2e-shard.mjs: the spec files of one macos-e2e shard, split by the measured seconds of each
// file in test/e2e/timings.json instead of Playwright's split by the count of tests.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'e2e-shard.mjs')

interface Shard {
  files: string[]
  seconds: number
}
interface Io {
  root?: string
  out: (text: string) => void
  err: (line: string) => void
  output?: (line: string) => void
}
interface E2eShard {
  listSpecs: (root: string) => string[]
  readTimings: (root: string) => Record<string, number>
  median: (values: number[]) => number
  splitShards: (files: string[], seconds: Record<string, number>, n: number) => Shard[]
  e2eShard: (args: string[], io: Io) => number
}
const { listSpecs, readTimings, median, splitShards, e2eShard } = (await import(pathToFileURL(SCRIPT).href)) as E2eShard

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) removeTestTree(dir)
})

/** A repository root with the given spec files under test/e2e and the given table. */
function tree(specs: string[], seconds: Record<string, number>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-shard-')))
  dirs.push(root)
  for (const spec of [...specs, 'test/e2e/helpers.ts']) {
    mkdirSync(join(root, spec, '..'), { recursive: true })
    writeFileSync(join(root, spec), '')
  }
  writeFileSync(join(root, 'test/e2e/timings.json'), JSON.stringify({ runs: [1], seconds }))
  return root
}

/** The script in this process: its exit code, stdout, stderr and the GITHUB_OUTPUT lines. */
function run(args: string[], root?: string): { code: number; out: string; err: string; output: string[] } {
  let out = ''
  let err = ''
  const output: string[] = []
  const code = e2eShard(args, { root, out: (text) => (out += text), err: (line) => (err += `${line}\n`), output: (line) => output.push(line) })
  return { code, out, err, output }
}

const shardsOf = (n: number, root?: string): string[][] =>
  Array.from({ length: n }, (_, at) => run([`${at + 1}/${n}`], root).out.split('\n').filter((line) => line !== ''))

describe('scripts/e2e-shard.mjs', () => {
  it.each([1, 2, 3])('puts every test/e2e spec file into exactly one of %i shards', (n) => {
    const specs = listSpecs(REPO)
    expect(specs.length).toBeGreaterThan(50)
    const shards = shardsOf(n)
    for (const files of shards) expect(files.length).toBeGreaterThan(0)
    expect(shards.flat().sort()).toEqual(specs)
  })

  it('gives the same shards on every run, whatever the order of the files given', () => {
    const specs = listSpecs(REPO)
    const seconds = readTimings(REPO)
    const first = splitShards(specs, seconds, 2)
    expect(splitShards([...specs].reverse(), seconds, 2)).toEqual(first)
    expect(splitShards(specs, seconds, 2)).toEqual(first)
    expect(shardsOf(2)).toEqual(first.map((shard) => shard.files))
  })

  it('breaks a tie of seconds by the name, and a tie of shard time by the lower shard', () => {
    const shards = splitShards(['c.spec.ts', 'a.spec.ts', 'b.spec.ts', 'd.spec.ts'], { 'a.spec.ts': 5, 'b.spec.ts': 5, 'c.spec.ts': 5, 'd.spec.ts': 5 }, 2)
    expect(shards).toEqual([
      { files: ['a.spec.ts', 'c.spec.ts'], seconds: 10 },
      { files: ['b.spec.ts', 'd.spec.ts'], seconds: 10 },
    ])
  })

  it('gives a spec file the table does not know the median of the table, and ignores an entry with no file', () => {
    expect(median([1, 9, 3])).toBe(3)
    expect(median([1, 9, 3, 5])).toBe(4)
    const root = tree(['test/e2e/a.spec.ts', 'test/e2e/b.spec.ts', 'test/e2e/new.spec.ts'], {
      'test/e2e/a.spec.ts': 10,
      'test/e2e/b.spec.ts': 2,
      'test/e2e/gone.spec.ts': 6,
    })
    const shards = splitShards(listSpecs(root), readTimings(root), 2)
    // new.spec.ts counts as 6, the median of 10, 2 and 6; gone.spec.ts is in no shard.
    expect(shards).toEqual([
      { files: ['test/e2e/a.spec.ts'], seconds: 10 },
      { files: ['test/e2e/b.spec.ts', 'test/e2e/new.spec.ts'], seconds: 8 },
    ])
    expect(run(['2/2'], root).out).toBe('test/e2e/b.spec.ts\ntest/e2e/new.spec.ts\n')
    expect(shardsOf(2, root).flat()).not.toContain('test/e2e/gone.spec.ts')
  })

  it('splits the two shards of the current table to within 10 % of the total', () => {
    const shards = splitShards(listSpecs(REPO), readTimings(REPO), 2)
    const total = shards.reduce((sum, shard) => sum + shard.seconds, 0)
    const [one, two] = shards.map((shard) => shard.seconds)
    expect(Math.abs((one ?? 0) - (two ?? 0))).toBeLessThan(total * 0.1)
  })

  it('splits only the spec files given after <i>/<n>, not every file', () => {
    const subset = ['test/e2e/browser.spec.ts', 'test/e2e/terminal.spec.ts', './test/e2e/agent.spec.ts']
    const one = run(['1/2', ...subset])
    const two = run(['2/2', ...subset])
    expect(one.code, one.err).toBe(0)
    expect(two.code, two.err).toBe(0)
    const given = [...one.out.split('\n'), ...two.out.split('\n')].filter((line) => line !== '').sort()
    expect(given).toEqual(['test/e2e/agent.spec.ts', 'test/e2e/browser.spec.ts', 'test/e2e/terminal.spec.ts'])
    // browser 53.4 s alone; terminal 47.3 s and agent 10.9 s together.
    expect(one.out).toBe('test/e2e/browser.spec.ts\n')
    expect(one.err).toMatch(/1 of 3 spec files/)
  })

  it('writes the files of the shard to GITHUB_OUTPUT as one line separated by spaces', () => {
    const result = run(['1/2'])
    expect(result.code, result.err).toBe(0)
    expect(result.output).toEqual([`files=${result.out.trim().split('\n').join(' ')}`])
  })

  it('hands Playwright names that match their own file only', () => {
    // playwright test reads each file argument as a regular expression of the file's path.
    const specs = listSpecs(REPO)
    for (const arg of specs) {
      expect(arg).toMatch(/^[A-Za-z0-9._/-]+$/)
      const re = new RegExp(arg, 'i')
      expect(specs.filter((spec) => re.test(join(REPO, spec).split('\\').join('/'))), arg).toEqual([arg])
    }
  })

  it.each([
    [[], 2, /no shard given/],
    [['3/2'], 2, /is not <i>\/<n>/],
    [['0/2'], 2, /is not <i>\/<n>/],
    [['1/2', 'test/e2e/helpers.ts'], 2, /not a spec file under test\/e2e: test\/e2e\/helpers.ts/],
    [['3/3', 'test/e2e/browser.spec.ts', 'test/e2e/terminal.spec.ts'], 1, /shard 3\/3 gets no spec file of 2/],
  ])('refuses %j with exit code %i', (args, code, message) => {
    const result = run(args)
    expect(result.code).toBe(code)
    expect(result.err).toMatch(message)
    expect(result.out).toBe('')
    expect(result.output).toEqual([])
  })

  it('stops with exit code 1 when the table cannot be read', () => {
    const root = tree(['test/e2e/a.spec.ts'], {})
    writeFileSync(join(root, 'test/e2e/timings.json'), JSON.stringify({ seconds: { 'test/e2e/a.spec.ts': 'slow' } }))
    const result = run(['1/1'], root)
    expect(result.code).toBe(1)
    expect(result.err).toMatch(/cannot read test\/e2e\/timings.json: test\/e2e\/a.spec.ts: "slow" is not a number of seconds/)
  })

  it('records the source runs in the table, at least five', () => {
    // A new spec file needs no entry (it gets the median); the table is refreshed from new runs.
    const table = JSON.parse(readFileSync(join(REPO, 'test/e2e/timings.json'), 'utf8')) as { runs: number[] }
    expect(table.runs.length).toBeGreaterThanOrEqual(5)
    expect(Object.keys(readTimings(REPO)).length).toBeGreaterThan(50)
  })

  it('runs as a command: prints the files of the shard and its expected seconds', () => {
    const result = spawnSync(scriptNode(), [SCRIPT, '2/2'], { cwd: REPO, encoding: 'utf8', timeout: ms(30_000), env: { ...process.env, GITHUB_OUTPUT: '' } })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.split('\n').filter((line) => line !== '')).toEqual(shardsOf(2)[1])
    expect(result.stderr).toMatch(/^e2e-shard: shard 2\/2: \d+ of \d+ spec files, [\d.]+ s expected of [\d.]+ s/)
  })
})
