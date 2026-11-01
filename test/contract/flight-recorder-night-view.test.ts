// The timeline of the night Run as the Run history screen gets it from main (worfy-flight-recorder ticket
// 18): test/fixtures/flight-recorder/night-run-view.json, which the screen's jsdom test
// (test/unit/flight-recorder-view.test.tsx) draws, since a renderer test cannot run the service. This test
// keeps the file true: it is what the Flight Recorder service answers today over the night-Run fixture (its
// Journal, transcripts and gate logs; gh answered in this process from its gh answers, as
// test/fixtures/flight-recorder/gh-night-run.mjs answers them for a process). No process starts and nothing
// reaches GitHub. After a change of the model or a reader, write the file again:
// WORFY_WRITE_NIGHT_VIEW=1 pnpm test -- test/contract/flight-recorder-night-view.test.ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FlightRecorder, type FlightRecorderOptions } from '../../src/main/flight-recorder/service'
import { runViewSchema } from '../../src/shared/ipc/runs'
import { DEFAULT_PIPELINE } from '../../src/shared/workflow/pipeline'

const FIXTURES = join(__dirname, '..', 'fixtures', 'flight-recorder')
const NIGHT = join(FIXTURES, 'night-run')
const VIEW_FILE = join(FIXTURES, 'night-run-view.json')
const NIGHT_RUN = '2026-10-17T22-29-32-707Z-58e783'
const NIGHT_PROJECT = 'CanvasForAI-38cb72ec'
const NIGHT_ROOT = '/Users/someone/Stuff/CanvasForAI'
const ANSWERS = join(NIGHT, 'gh')

/** gh as the stand-in answers it: `pr list --head`, `run list --branch`, `run list --commit`. */
const nightGh: FlightRecorderOptions['gh'] = async (_root, args) => {
  const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
  const files = readdirSync(ANSWERS)
  const read = (file: string): unknown => JSON.parse(readFileSync(join(ANSWERS, file), 'utf8'))
  const command = `${args[0] ?? ''} ${args[1] ?? ''}`
  if (command === 'pr list' && option('--head') !== undefined) {
    const prs = files.filter((file) => /^pr-view-\d+\.json$/.test(file)).map(read) as { number: number; headRefName: string }[]
    return JSON.stringify(prs.filter((pr) => pr.headRefName === option('--head')).sort((a, b) => b.number - a.number))
  }
  if (command === 'run list' && option('--branch') !== undefined) {
    const file = `run-list-${(option('--branch') ?? '').replaceAll('/', '-')}.json`
    return JSON.stringify(files.includes(file) ? read(file) : [])
  }
  if (command === 'run list' && option('--commit') !== undefined) {
    const runs = files.filter((file) => /^run-list-.+\.json$/.test(file)).flatMap((file) => read(file) as { headSha: string }[])
    return JSON.stringify(runs.filter((run) => run.headSha === option('--commit')))
  }
  throw new Error(`gh: unsupported command: ${args.join(' ')}`)
}

describe('the night Run as the Run history screen gets it', () => {
  it('is the file the screen test draws', async () => {
    const recorder = new FlightRecorder({
      env: { WORFY_DATA_DIR: join(NIGHT, 'data'), WORFY_CLAUDE_HOME: join(NIGHT, 'claude') },
      harnessHome: join(NIGHT, 'harness'),
      projectRoot: (projectId) => {
        if (projectId !== NIGHT_PROJECT) throw new Error(`no Project ${projectId}`)
        return NIGHT_ROOT
      },
      // The fixture's verdict comments are by `owner`, the anonymised owner of the repository.
      profile: async () => ({ name: 'worfy', mode: 'full', finish: 'pr-green-ci', pipeline: DEFAULT_PIPELINE, account: 'owner', accountReason: null, crossMachineGate: null, reason: null }),
      gh: nightGh,
      running: () => false,
      // The fixture's repository: its page gives the PR and commit links of the screen (RunView.repoUrl).
      git: async (_cwd, args) => (args.join(' ') === 'remote get-url origin' ? { code: 0, stdout: 'git@github.com:someone/worfy.git\n' } : { code: 128, stdout: '' }),
      now: () => Date.parse('2026-11-01T10:00:00Z'),
    })
    const view = runViewSchema.parse(await recorder.view(NIGHT_PROJECT, NIGHT_RUN))
    if (process.env.WORFY_WRITE_NIGHT_VIEW === '1') writeFileSync(VIEW_FILE, `${JSON.stringify(view, null, 1)}\n`)
    expect(runViewSchema.parse(JSON.parse(readFileSync(VIEW_FILE, 'utf8')))).toEqual(view)
  })
})
