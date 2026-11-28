// How the runner of the Harness contract set (src/main/harness/contract/runner.ts, epic
// worfy-harness-guarantees ticket 08) judges a run of Claude Code before a case looks at it: not-run
// only while nothing can be said about the Harness, failed once Claude Code came up with the plugin
// and a hook of it blocked the run or no turn reached the stand-in (review round 1 of PR #2345). The
// runs on the real binary are in test/contract/harness-guarantees.test.ts.
import { describe, expect, it } from 'vitest'
import { judgeRun, type RunTrace, type StreamLine } from '../../src/main/harness/contract/runner'

const INIT: StreamLine = { type: 'system', subtype: 'init', session_id: 's' }
const RESULT: StreamLine = { type: 'result', subtype: 'success', is_error: false }
const API_ERROR: StreamLine = { type: 'result', subtype: 'success', is_error: true, result: 'API Error: 500 the stand-in failed' }
const hook = (event: string, exitCode: number, stderr = '', stdout = ''): StreamLine => ({ type: 'system', subtype: 'hook_response', hook_event: event, hook_name: event, exit_code: exitCode, outcome: exitCode === 0 ? 'success' : 'error', stderr, stdout })

const trace = (over: Partial<RunTrace>): RunTrace => ({ timedOut: false, limitMs: 1000, exitCode: 0, lines: [INIT, RESULT], stderr: '', requests: 2, ...over })

describe('judgeRun', () => {
  it('a complete run goes to the case', () => {
    expect(judgeRun(trace({}))).toEqual({ status: 'ran', init: INIT })
  })

  it('a complete run goes to the case even when a hook blocked on the way: the Stop case expects that', () => {
    expect(judgeRun(trace({ lines: [INIT, hook('Stop', 2, 'The quality gate is red'), RESULT] })).status).toBe('ran')
  })

  it('a binary that did not start: not run', () => {
    expect(judgeRun(trace({ startError: 'claude: ENOENT', lines: [], requests: 0, exitCode: null }))).toEqual({ status: 'not-run', reason: 'could not start the binary: claude: ENOENT' })
  })

  it('no system/init: not run, with the exit code', () => {
    const verdict = judgeRun(trace({ lines: [], requests: 0, exitCode: 1, stderr: 'bad flag' }))
    expect(verdict).toEqual({ status: 'not-run', reason: 'Claude Code printed no system/init (exit code 1); stderr: bad flag' })
  })

  it('no system/init and the time limit: not run, naming the limit', () => {
    const verdict = judgeRun(trace({ lines: [], requests: 0, exitCode: null, timedOut: true }))
    expect(verdict.status === 'not-run' && verdict.reason).toMatch(/stopped at the limit of 1000 ms/)
  })

  // Review round 2 of PR #2345: no turn is the Harness's fault only when a hook of the plugin held it up.
  it('init and no turn, no hook blocked or hung, exit code 0: not run', () => {
    const verdict = judgeRun(trace({ requests: 0 }))
    expect(verdict.status === 'not-run' && verdict.reason).toMatch(/asked the stand-in no turn \(exit code 0\)/)
  })

  it('init, no turn and the time limit, no hook blocked or hung: not run (a slow machine)', () => {
    const verdict = judgeRun(trace({ requests: 0, lines: [INIT], timedOut: true, exitCode: null }))
    expect(verdict.status === 'not-run' && verdict.reason).toMatch(/did not finish in 1000 ms/)
  })

  it('init, no turn and an API error, no hook blocked or hung: not run (the API cannot be reached)', () => {
    const verdict = judgeRun(trace({ requests: 0, lines: [INIT, API_ERROR] }))
    expect(verdict.status === 'not-run' && verdict.reason).toMatch(/an error of the API or of Claude Code/)
  })

  it('init, no turn and a hook of the plugin that started and never answered: failed, naming the hook', () => {
    const started: StreamLine = { type: 'system', subtype: 'hook_started', hook_id: 'h1', hook_name: 'UserPromptSubmit', hook_event: 'UserPromptSubmit' }
    const answered: StreamLine[] = [
      { type: 'system', subtype: 'hook_started', hook_id: 'h0', hook_name: 'SessionStart', hook_event: 'SessionStart' },
      { ...hook('SessionStart', 0), hook_id: 'h0' },
    ]
    const verdict = judgeRun(trace({ requests: 0, lines: [INIT, ...answered, started], timedOut: true, exitCode: null }))
    expect(verdict).toEqual({ status: 'failed', reason: expect.stringMatching(/hooks of the plugin that never answered: UserPromptSubmit/) as unknown as string })
  })

  it('init and no turn, a UserPromptSubmit hook blocked: failed, naming the hook', () => {
    const verdict = judgeRun(trace({ requests: 0, lines: [INIT, hook('UserPromptSubmit', 2, 'blocked'), RESULT] }))
    expect(verdict.status === 'failed' && verdict.reason).toMatch(/hooks of the plugin blocked: UserPromptSubmit \(exit code 2\): blocked/)
  })

  it('a hook that blocks by its JSON answer counts as blocking', () => {
    const verdict = judgeRun(trace({ requests: 0, lines: [INIT, hook('UserPromptSubmit', 0, '', '{"decision":"block","reason":"no"}')] }))
    expect(verdict.status === 'failed' && verdict.reason).toMatch(/UserPromptSubmit \(exit code 0\)/)
  })

  it('an API error with no hook blocking: not run', () => {
    const verdict = judgeRun(trace({ lines: [INIT, API_ERROR] }))
    expect(verdict.status === 'not-run' && verdict.reason).toMatch(/an error of the API or of Claude Code/)
  })

  it('an API error while a hook blocked: failed', () => {
    expect(judgeRun(trace({ lines: [INIT, hook('Stop', 2, 'held'), API_ERROR] })).status).toBe('failed')
  })

  it('no result line with no hook blocking: not run', () => {
    const verdict = judgeRun(trace({ lines: [INIT], exitCode: 1 }))
    expect(verdict.status === 'not-run' && verdict.reason).toMatch(/printed no result \(exit code 1\)/)
  })

  it('the time limit with no hook blocking: not run', () => {
    const verdict = judgeRun(trace({ lines: [INIT], timedOut: true, exitCode: null, requests: 3 }))
    expect(verdict.status === 'not-run' && verdict.reason).toMatch(/did not finish in 1000 ms and was stopped; 3 turns asked the stand-in/)
  })

  it('the time limit while a Stop hook held the turns: failed, naming the hook', () => {
    const verdict = judgeRun(trace({ lines: [INIT, hook('Stop', 2, 'held'), hook('Stop', 2, 'held')], timedOut: true, exitCode: null, requests: 25 }))
    expect(verdict).toEqual({ status: 'failed', reason: 'Claude Code did not finish in 1000 ms and was stopped; 25 turns asked the stand-in; hooks of the plugin blocked: Stop (exit code 2): held' })
  })
})
