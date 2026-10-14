// The input of a Terminal AI request out of the state of a Terminal's shell
// (src/main/terminal-ai/input.ts): what every feature sends to the assist service.
import { describe, expect, it } from 'vitest'
import type { ShellState } from '../../src/main/terminal/osc'
import { terminalAiInput } from '../../src/main/terminal-ai/input'
import { prepareContext, terminalAiInputSchema } from '../../src/shared/terminal-ai/context'

function state(over: Partial<ShellState> = {}): ShellState {
  return { cwd: '/Users/me/work', awaitingInput: true, commandRunning: false, altScreen: false, exitCode: 0, commands: ['ls', 'cd work'], lastOutput: null, ...over }
}

describe('terminalAiInput', () => {
  it('carries the line, the folder, the last commands and the exit code of the last one', () => {
    const input = terminalAiInput(state({ exitCode: 127, commands: ['npm install', 'npm tset'] }), 'npm t')
    expect(input).toEqual({ line: 'npm t', cwd: '/Users/me/work', commands: ['npm install', 'npm tset'], exitCode: 127, commandRunning: false, alternateScreen: false })
    expect(terminalAiInputSchema.safeParse(input).success).toBe(true)
  })

  it('carries an unknown exit code as null and an empty line as it is', () => {
    expect(terminalAiInput(state({ exitCode: null, commands: [] }), '')).toEqual({ line: '', cwd: '/Users/me/work', commands: [], exitCode: null, commandRunning: false, alternateScreen: false })
  })

  it('carries the signs "a command runs" and "alternate screen", each by itself', () => {
    expect(terminalAiInput(state({ commandRunning: true, awaitingInput: false }), 'x')).toMatchObject({ commandRunning: true, alternateScreen: false })
    expect(terminalAiInput(state({ altScreen: true }), 'x')).toMatchObject({ commandRunning: false, alternateScreen: true })
  })

  it('is null for a shell that has not told its folder', () => {
    expect(terminalAiInput(state({ cwd: null }), 'git st')).toBeNull()
    expect(terminalAiInput(state({ cwd: null }), 'git st', { request: 'show the status' })).toBeNull()
  })

  it('names no branch: the assist service finds it', () => {
    const input = terminalAiInput(state(), 'git st')
    expect(input).not.toBeNull()
    expect(Object.keys(input ?? {})).not.toContain('branch')
  })

  it('takes nothing else of the state: the output of the last command stays out unless the caller gives it', () => {
    const input = terminalAiInput(state({ lastOutput: 'secret output of the last command' }), 'git st')
    expect(JSON.stringify(input)).not.toContain('secret output')
    expect(Object.keys(input ?? {}).sort()).toEqual(['alternateScreen', 'commandRunning', 'commands', 'cwd', 'exitCode', 'line'])
  })

  it('adds the words of a Command request and the output tail of Fix when the caller gives them', () => {
    expect(terminalAiInput(state(), '', { request: 'list the big files' })).toMatchObject({ line: '', request: 'list the big files' })
    const fix = terminalAiInput(state({ exitCode: 1 }), '', { output: ['error: no such file', 'exit 1'] })
    expect(fix).toMatchObject({ output: ['error: no such file', 'exit 1'], exitCode: 1 })
    expect(Object.keys(fix ?? {})).not.toContain('request')
    // Only Fix sends the output on; the other features drop it in prepareContext.
    if (fix === null) throw new Error('unreachable')
    expect(prepareContext('fix', fix, null).output).toEqual(['error: no such file', 'exit 1'])
    expect(prepareContext('suggest', fix, null).output).toBeNull()
  })

  it('copies the lists: a later change of the state or of what the caller gave does not reach the input', () => {
    const commands = ['ls']
    const output = ['one']
    const input = terminalAiInput(state({ commands }), 'x', { output })
    commands.push('rm -rf /')
    output.push('two')
    expect(input?.commands).toEqual(['ls'])
    expect(input?.output).toEqual(['one'])
  })
})
