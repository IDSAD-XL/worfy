// The hook row of the Session view (src/renderer/session/Transcript.tsx, worfy-daily ticket 25):
// a cross only for an outcome that is an error and for a non-zero exit code; the output of a
// successful hook (a SessionStart systemMessage, its additionalContext) under a check.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import { Transcript } from '../../src/renderer/session/Transcript'
import { parseTranscriptLine } from '../../src/shared/transcript/parse'

type Hook = Extract<AgentEvent, { type: 'hook' }>

const hook = (overrides: Partial<Hook> = {}): Hook => ({
  type: 'hook',
  hookEvent: 'SessionStart',
  hookName: 'SessionStart:startup',
  exitCode: null,
  outcome: 'success',
  stdout: '',
  stderr: '',
  ...overrides,
})

const fromTranscript = (attachment: Record<string, unknown>): AgentEvent[] =>
  parseTranscriptLine(JSON.stringify({ type: 'attachment', attachment })).map((entry) => entry.event)

const row = () => screen.getByTestId('transcript-hook')
const crossed = () => row().querySelector('.w-tr__status--blocked') !== null
const checked = () => row().querySelector('.w-tr__status--ready') !== null

afterEach(cleanup)

describe('the hook row', () => {
  it('draws a SessionStart systemMessage read from a transcript with a check and its text', () => {
    render(<Transcript events={fromTranscript({ type: 'hook_system_message', content: 'Worktree /tmp/x is ready', hookName: 'SessionStart:startup', hookEvent: 'SessionStart' })} />)
    expect(crossed()).toBe(false)
    expect(checked()).toBe(true)
    fireEvent.click(within(row()).getByRole('button'))
    expect(row().textContent).toContain('Worktree /tmp/x is ready')
  })

  it('draws an additionalContext read from a transcript with a check and its text', () => {
    render(<Transcript events={fromTranscript({ type: 'hook_additional_context', content: ['## Personal rules'], hookName: 'SessionStart', hookEvent: 'SessionStart' })} />)
    expect(crossed()).toBe(false)
    fireEvent.click(within(row()).getByRole('button'))
    expect(row().textContent).toContain('## Personal rules')
  })

  it('draws a hook with a non-zero exit code with a cross, as before', () => {
    render(<Transcript events={[hook({ exitCode: 127, outcome: 'non_blocking_error', stderr: 'node: not found' })]} />)
    expect(crossed()).toBe(true)
    expect(row().textContent).toContain('exit 127')
  })

  it('draws a hook whose outcome succeeded but whose exit code is not zero with a cross', () => {
    render(<Transcript events={[hook({ exitCode: 2, outcome: 'success', stdout: 'out' })]} />)
    expect(crossed()).toBe(true)
  })

  it.each(['error', 'cancelled', 'blocked', 'blocking_error', 'non_blocking_error', 'error_during_execution', 'stopped_continuation'])(
    'draws the error outcome %s with a cross',
    (outcome) => {
      render(<Transcript events={[hook({ outcome, stderr: 'why' })]} />)
      expect(crossed()).toBe(true)
    },
  )

  it('draws a successful hook with output and exit 0 with a check', () => {
    render(<Transcript events={[hook({ exitCode: 0, stdout: 'done' })]} />)
    expect(crossed()).toBe(false)
    expect(checked()).toBe(true)
  })
})

describe('the hook row of an outcome that is not an error', () => {
  it.each(['permission_decision', 'deferred_tool'])('draws %s without a cross', (outcome) => {
    render(<Transcript events={[hook({ hookEvent: 'PreToolUse', outcome })]} />)
    expect(crossed()).toBe(false)
  })
})
