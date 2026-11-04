// The user's own messages in the transcript (worfy-polish ticket 57): a prompt and a slash command
// the user typed are marked as the user's rows, which session.css draws at the right edge with an
// accent side; the assistant's answer, a synthetic message and a tool row stay as they were.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agent/events'
import { Transcript } from '../../src/renderer/session/Transcript'

afterEach(cleanup)

const prompt = (text: string): AgentEvent => ({ type: 'notice', kind: 'user', text })
const text = (value: string, synthetic = false): AgentEvent => ({ type: 'text', text: value, messageId: `m-${value}`, parentToolUseId: null, synthetic })
const toolUse = (id: string, name: string): AgentEvent => ({ type: 'tool_use', id, name, input: {}, parentToolUseId: null })

describe('the user\'s rows in the transcript', () => {
  it('a prompt row is the user\'s row; the answer and a synthetic message are not', () => {
    render(<Transcript events={[prompt('fix the test'), text('Done.'), prompt('and the other one'), text('Not this one.', true)]} />)
    const prompts = screen.getAllByTestId('transcript-prompt')
    expect(prompts).toHaveLength(2)
    for (const row of prompts) {
      expect(row.classList.contains('w-tr__row--user')).toBe(true)
      expect(row.querySelector('.w-tr__prompt')).not.toBeNull()
    }
    const answers = screen.getAllByTestId('transcript-text')
    expect(answers).toHaveLength(2)
    for (const row of answers) expect(row.classList.contains('w-tr__row--user')).toBe(false)
  })

  it('a tool row is not the user\'s row', () => {
    render(<Transcript events={[prompt('lint'), toolUse('t1', 'Bash'), text('Clean.')]} />)
    expect(screen.getByTestId('transcript-tools').classList.contains('w-tr__row--user')).toBe(false)
  })

  it('a slash command the user typed is drawn as the user\'s row too', () => {
    render(<Transcript events={[{ type: 'command', name: '/epic-wave', args: 'demo-epic 1' }]} />)
    const row = screen.getByTestId('transcript-command')
    expect(row.classList.contains('w-tr__row--user')).toBe(true)
    expect(row.querySelector('.w-tr__prompt')?.textContent).toBe('/epic-wave demo-epic 1')
  })
})
