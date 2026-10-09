// The context of a Terminal AI request (src/shared/terminal-ai/context.ts): what goes to the model,
// trimmed and redacted, and the text built from it.
import { describe, expect, it } from 'vitest'
import { MAX_COMMANDS, MAX_OUTPUT_LINES, contextText, prepareContext, terminalAiInputSchema, type TerminalAiInput } from '../../src/shared/terminal-ai/context'
import { REDACTED } from '../../src/shared/terminal-ai/redact'
import { TERMINAL_AI_FEATURES } from '../../src/shared/terminal-ai/settings'

const TOKEN = `ghp_${'Ab12'.repeat(9)}`

function input(over: Partial<TerminalAiInput> = {}): TerminalAiInput {
  return { line: 'git st', cwd: '/Users/me/work', commands: ['ls', 'cd work'], branch: 'main', exitCode: 0, commandRunning: false, alternateScreen: false, ...over }
}

describe('prepareContext', () => {
  it('sends the output tail only with Fix', () => {
    const output = ['error: something', 'at line 3']
    for (const feature of TERMINAL_AI_FEATURES) {
      const context = prepareContext(feature, input({ output }))
      expect(context.output).toEqual(feature === 'fix' ? output : null)
      expect(contextText(feature, context).includes('error: something')).toBe(feature === 'fix')
    }
  })

  it('keeps at most 20 commands and 50 output lines, the last ones', () => {
    const commands = Array.from({ length: 30 }, (_, n) => `echo ${n}`)
    const output = Array.from({ length: 80 }, (_, n) => `line ${n}`)
    const context = prepareContext('fix', input({ commands, output }))
    expect(context.commands).toHaveLength(MAX_COMMANDS)
    expect(context.commands[0]).toBe('echo 10')
    expect(context.commands.at(-1)).toBe('echo 29')
    expect(context.output).toHaveLength(MAX_OUTPUT_LINES)
    expect(context.output?.[0]).toBe('line 30')
    expect(context.output?.at(-1)).toBe('line 79')
  })

  it('drops a line and commands that start with a space', () => {
    const context = prepareContext('next', input({ line: ' mysql -p secret', commands: ['ls', ' export X=1', '\tcurl -u a:b x', 'pwd'] }))
    expect(context.line).toBe('')
    expect(context.commands).toEqual(['ls', 'pwd'])
    const text = contextText('next', context)
    expect(text).not.toContain('mysql')
    expect(text).not.toContain('export X')
    expect(text).not.toContain('curl')
  })

  it('redacts every field before the text is built', () => {
    const context = prepareContext(
      'fix',
      input({
        line: `GH_TOKEN=${TOKEN} gh pr list`,
        request: `clone with ${TOKEN}`,
        cwd: `/tmp/${TOKEN}`,
        commands: [`git push https://me:hunter2@github.com/o/r.git`],
        branch: `feature/${TOKEN}`,
        output: [`fatal: token ${TOKEN} rejected`],
      }),
    )
    expect(context).toEqual({
      line: `GH_TOKEN=${REDACTED} gh pr list`,
      request: `clone with ${REDACTED}`,
      cwd: `/tmp/${REDACTED}`,
      commands: [`git push https://me:${REDACTED}@github.com/o/r.git`],
      branch: `feature/${REDACTED}`,
      exitCode: 0,
      output: [`fatal: token ${REDACTED} rejected`],
    })
    const text = contextText('fix', context)
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain('hunter2')
  })

  it('takes the branch main found when the shell did not send one', () => {
    expect(prepareContext('next', input({ branch: undefined }), 'dev').branch).toBe('dev')
    expect(prepareContext('next', input({ branch: undefined })).branch).toBeNull()
  })

  it('has no field for environment variables: the input schema drops them', () => {
    const parsed = terminalAiInputSchema.parse({ ...input(), env: { GITHUB_TOKEN: TOKEN } })
    expect(parsed).not.toHaveProperty('env')
    expect(JSON.stringify(prepareContext('fix', parsed))).not.toContain(TOKEN)
  })
})

describe('contextText', () => {
  it('labels each field and puts the typed line last for a Suggestion', () => {
    const text = contextText('suggest', prepareContext('suggest', input({ exitCode: 1 })))
    expect(text).toBe(['Folder: /Users/me/work', 'Git branch: main', 'Recent commands, oldest first:\n  ls\n  cd work', 'Exit code of the last command: 1', 'Typed so far: git st'].join('\n\n'))
  })

  it('carries the words of a Command request', () => {
    const text = contextText('request', prepareContext('request', input({ line: '', request: 'find big files' })))
    expect(text).toContain('Request: find big files')
    expect(text).not.toContain('Current input line')
  })
})
