// The messages between a Terminal's zsh and main (src/main/terminal-ai/protocol.ts): every message
// survives the way there and back, whatever its text holds, and what is not a message is refused.
import { describe, expect, it } from 'vitest'
import {
  decodeField,
  encodeField,
  encodeMessage,
  parseMainMessage,
  parseShellMessage,
  type MainMessage,
  type ShellMessage,
} from '../../src/main/terminal-ai/protocol'
import { configFeatures, featureModules } from '../../src/main/terminal-ai/shell-link'
import { DEFAULT_TERMINAL_AI_SETTINGS } from '../../src/shared/terminal-ai/settings'

/** Text with everything the encoding has to carry: TAB, line feeds, backslashes, Cyrillic, emoji. */
const HARD = 'git commit -m "строка\tс табом\nвторая \\n не перевод\r\\\\ два \\t 🚀 👩‍💻" \\'

const SHELL_MESSAGES: ShellMessage[] = [
  { type: 'hello', token: '0123456789abcdef0123456789abcdef' },
  { type: 'ask', id: 1, feature: 'suggest', line: 'git st' },
  { type: 'ask', id: 2147483647, feature: 'next-command', line: '' },
  { type: 'ask', id: 7, feature: 'request', line: HARD },
  { type: 'cancel', id: 7 },
]

const MAIN_MESSAGES: MainMessage[] = [
  { type: 'show', id: 3, text: 'atus --short' },
  { type: 'show', id: 3, text: HARD },
  { type: 'status', id: 0, text: 'Limits until 14:20' },
  { type: 'status', id: 9, text: 'asking Claude…' },
  { type: 'status', id: 9, text: '' },
  { type: 'insert', text: 'git status' },
  { type: 'insert', text: HARD },
  { type: 'config', features: ['history', 'suggest', 'next', 'request', 'fix'] },
  { type: 'config', features: [] },
]

describe('a field', () => {
  it('holds no separator once encoded, and comes back as it was', () => {
    for (const text of [HARD, '', '\\', '\\\\', '\\n', '\n', '\t\t', 'a\\', '\\\n', '\r\n', 'кириллица', '🚀']) {
      const field = encodeField(text)
      expect(field).not.toMatch(/[\n\t\r]/)
      expect(decodeField(field)).toBe(text)
    }
  })

  it('a backslash before a letter that is no escape stays as written', () => {
    expect(decodeField('a\\x41 \\e')).toBe('a\\x41 \\e')
  })
})

describe('the messages', () => {
  it.each(SHELL_MESSAGES)('shell → main $type is one line and is read back the same', (message) => {
    const line = encodeMessage(message)
    expect(line).not.toMatch(/[\n\r]/)
    expect(line.split('\t')[0]).toBe(message.type)
    expect(parseShellMessage(line)).toEqual(message)
    // Main does not take a message of its own for one of the shell's.
    expect(parseMainMessage(line)).toBeNull()
  })

  it.each(MAIN_MESSAGES)('main → shell $type is one line and is read back the same', (message) => {
    const line = encodeMessage(message)
    expect(line).not.toMatch(/[\n\r]/)
    expect(line.split('\t')[0]).toBe(message.type)
    expect(parseMainMessage(line)).toEqual(message)
    expect(parseShellMessage(line)).toBeNull()
  })

  it('the exact lines of the protocol', () => {
    expect(encodeMessage({ type: 'hello', token: 'abc' })).toBe('hello\tabc')
    expect(encodeMessage({ type: 'ask', id: 4, feature: 'suggest', line: 'a\tb\nc\\d' })).toBe('ask\t4\tsuggest\ta\\tb\\nc\\\\d')
    expect(encodeMessage({ type: 'cancel', id: 4 })).toBe('cancel\t4')
    expect(encodeMessage({ type: 'show', id: 4, text: 'x y' })).toBe('show\t4\tx y')
    expect(encodeMessage({ type: 'status', id: 0, text: 'asking Claude…' })).toBe('status\t0\tasking Claude…')
    expect(encodeMessage({ type: 'insert', text: 'git status' })).toBe('insert\tgit status')
    expect(encodeMessage({ type: 'config', features: ['history', 'fix'] })).toBe('config\thistory fix')
  })

  it('what is not a message is refused', () => {
    for (const line of [
      '',
      'hello',
      'hello\t',
      'hello\ta\tb',
      'ask\t1\tsuggest',
      'ask\t0\tsuggest\tline',
      'ask\t-1\tsuggest\tline',
      'ask\t1.5\tsuggest\tline',
      'ask\t1e3\tsuggest\tline',
      'ask\t99999999999\tsuggest\tline',
      'ask\tx[$(id)]\tsuggest\tline',
      'ask\t1\tSuggest\tline',
      'ask\t1\tsug gest\tline',
      'ask\t1\tsuggest\tline\textra',
      'cancel',
      'cancel\t0',
      'cancel\t1\t2',
      'show\t1\ttext',
      'run\tls',
    ]) {
      expect(parseShellMessage(line), JSON.stringify(line)).toBeNull()
    }
    for (const line of ['show\t0\ttext', 'show\t1', 'status\t-1\tx', 'status\t1', 'insert', 'insert\ta\tb', 'config', 'config\tHistory', 'ask\t1\tsuggest\tx']) {
      expect(parseMainMessage(line), JSON.stringify(line)).toBeNull()
    }
  })

  it('a config never carries a name the shell would not take as a feature', () => {
    expect(encodeMessage({ type: 'config', features: ['history', 'a b', 'x;y', 'fix'] })).toBe('config\thistory fix')
  })
})

describe('the features a shell is told are on', () => {
  const settings = DEFAULT_TERMINAL_AI_SETTINGS

  it('by default everything, the Suggestion from history first', () => {
    expect(configFeatures(settings)).toEqual(['history', 'suggest', 'next', 'request', 'fix'])
  })

  it('"Ask Claude when history has nothing" off leaves the Suggestion from history on', () => {
    expect(configFeatures({ ...settings, suggestionAsksModel: false })).toEqual(['history', 'next', 'request', 'fix'])
  })

  it('"Suggestion" off turns off the Suggestion from history too', () => {
    expect(configFeatures({ ...settings, suggestion: false })).toEqual(['next', 'request', 'fix'])
  })

  it('"Terminal AI" off turns off everything', () => {
    expect(configFeatures({ ...settings, enabled: false })).toEqual([])
  })
})

describe('the modules of the features', () => {
  it('are found by themselves; none is there before the first feature adds its file', () => {
    // Each of worfy-terminal-ai tickets 04–06 adds src/main/terminal-ai/features/<feature>.ts.
    for (const [path, load] of Object.entries(featureModules)) {
      expect(path).toMatch(/^\.\/features\/[a-z0-9-]+\.ts$/)
      expect(load).toBeTypeOf('function')
    }
  })
})
