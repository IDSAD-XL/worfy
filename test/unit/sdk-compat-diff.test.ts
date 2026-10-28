// scripts/sdk-compat.mjs: how the messages captured with one Agent SDK version differ in shape from
// those of the next, on two small capture folders (test/fixtures/sdk-compat/old and new). Between
// them: a kind added and one gone, a key added, one gone and one retyped, Query methods added, gone
// and changed; and what is no difference — another model in `modelUsage`, another tool's `input`,
// the capture script's own `probe_error` line. Files only: no Claude Code, no SDK query.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { scriptNode } from '../script-node'

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'sdk-compat.mjs')
const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'sdk-compat')
const OLD = join(FIXTURES, 'old')
const NEW = join(FIXTURES, 'new')

interface Capture {
  messages: unknown[]
  manifest: unknown
}
interface SdkCompat {
  shapeOf(message: unknown): Record<string, string[]>
  readCapture(folder: string): Capture
  queryMethodsOf(declarations: string): Record<string, string>
  compareCaptures(a: Capture, b: Capture): unknown
  formatComparison(comparison: unknown): string
  sdkCompat(args: string[], out: (text: string) => void, err: (text: string) => void): number
}
const { shapeOf, readCapture, queryMethodsOf, compareCaptures, formatComparison, sdkCompat } = (await import(pathToFileURL(SCRIPT).href)) as SdkCompat

function run(args: string[]) {
  let stdout = ''
  let stderr = ''
  const code = sdkCompat(
    args,
    (text) => (stdout += text),
    (text) => (stderr += text),
  )
  return { code, stdout, stderr }
}

describe('the shape of a message', () => {
  it('is each key path with its JSON types; typed objects carry their type, records of data a *', () => {
    expect(
      shapeOf({
        type: 'assistant',
        message: { type: 'message', content: [{ type: 'tool_use', id: 'toolu_1', input: { command: 'ls' } }, { type: 'text', text: 'hi' }] },
        parent_tool_use_id: null,
        modelUsage: { 'claude-haiku-4-5': { inputTokens: 1 } },
      }),
    ).toEqual({
      'message(message)': ['object'],
      'message(message).content': ['array'],
      'message(message).content[](tool_use)': ['object'],
      'message(message).content[](tool_use).id': ['string'],
      'message(message).content[](tool_use).input': ['object'],
      'message(message).content[](text)': ['object'],
      'message(message).content[](text).text': ['string'],
      parent_tool_use_id: ['null'],
      modelUsage: ['object'],
      'modelUsage.*': ['object'],
      'modelUsage.*.inputTokens': ['number'],
    })
  })
})

describe('Query methods of sdk.d.ts', () => {
  it('lists each method with its whole declaration on one line, comments left out', () => {
    const declarations = [
      'export declare type Other = {',
      '    notAMethod(): void;',
      '};',
      'export declare interface Query extends AsyncGenerator<SDKMessage, void> {',
      '    /**',
      '     * Interrupts the turn. close() is something else.',
      '     */',
      '    interrupt(): Promise<void>;',
      '    applyFlagSettings(settings: {',
      '        /** The effort. */',
      '        effortLevel?: EffortLevel | null;',
      '    }): Promise<void>;',
      '    close(): void;',
      '}',
      'export declare function query(): Query;',
    ].join('\n')
    expect(queryMethodsOf(declarations)).toEqual({
      applyFlagSettings: 'applyFlagSettings(settings: {effortLevel?: EffortLevel | null;}): Promise<void>;',
      close: 'close(): void;',
      interrupt: 'interrupt(): Promise<void>;',
    })
  })

  it('refuses a declaration file without the Query interface', () => {
    expect(() => queryMethodsOf('export declare type Query = {}')).toThrow('declares no interface Query')
  })
})

describe('the comparison of two captures', () => {
  it('reads the messages of a folder without the capture script’s own probe_error lines', () => {
    expect(readCapture(OLD).messages).toHaveLength(4)
  })

  it('lists kinds, keys, types and Query methods that differ, and the versions', () => {
    expect(compareCaptures(readCapture(OLD), readCapture(NEW))).toEqual({
      versions: { sdk: { from: '0.3.289', to: '0.3.300' }, claudeCode: { from: '2.1.289', to: '2.1.300' } },
      kinds: { added: ['system/session_state_changed'], removed: ['system/hook_started'] },
      keys: {
        'result/success': { added: [], removed: [], retyped: [{ path: 'num_turns', from: ['number'], to: ['string'] }] },
        'system/init': { added: [{ path: 'fast_mode', types: ['boolean'] }], removed: [{ path: 'output_style', types: ['string'] }], retyped: [] },
      },
      methods: {
        added: ['stopTask(taskId: string): Promise<void>;'],
        removed: ['setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;'],
        changed: [{ name: 'setModel', from: 'setModel(model?: string): Promise<void>;', to: 'setModel(model: string): Promise<void>;' }],
      },
    })
  })

  it('prints one difference per line', () => {
    expect(formatComparison(compareCaptures(readCapture(OLD), readCapture(NEW)))).toBe(
      [
        'SDK 0.3.289 -> 0.3.300, Claude Code 2.1.289 -> 2.1.300',
        'message kinds:',
        '  + system/session_state_changed',
        '  - system/hook_started',
        'keys (kinds both captures have):',
        '  result/success',
        '    ~ num_turns: number -> string',
        '  system/init',
        '    + fast_mode: boolean',
        '    - output_style: string',
        'Query methods:',
        '  + stopTask(taskId: string): Promise<void>;',
        '  - setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;',
        '  ~ setModel(model?: string): Promise<void>;',
        '    setModel(model: string): Promise<void>;',
      ].join('\n'),
    )
  })

  it('finds nothing between a capture and itself', () => {
    expect(formatComparison(compareCaptures(readCapture(OLD), readCapture(OLD)))).toBe(
      ['SDK 0.3.289, Claude Code 2.1.289', 'no difference in message shapes or Query methods'].join('\n'),
    )
  })

  it('compares the messages of a folder without a manifest, versions unknown', () => {
    const bare = { messages: readCapture(OLD).messages, manifest: null }
    expect(formatComparison(compareCaptures(bare, bare))).toBe('SDK ?, Claude Code ?\nno difference in message shapes or Query methods')
  })
})

describe('the command line', () => {
  it('exits 1 with the differences, 0 without', () => {
    const differ = run(['diff', OLD, NEW])
    expect(differ.code).toBe(1)
    expect(differ.stdout).toContain('  + system/session_state_changed\n')
    expect(run(['diff', OLD, OLD])).toEqual({ code: 0, stdout: 'SDK 0.3.289, Claude Code 2.1.289\nno difference in message shapes or Query methods\n', stderr: '' })
  })

  it('exits 2 on a folder it cannot read and on wrong arguments', () => {
    const missing = run(['diff', OLD, join(FIXTURES, 'no-such-folder')])
    expect(missing.code).toBe(2)
    expect(missing.stderr).toMatch(/^sdk-compat: ENOENT/)
    const wrong = run(['diff', OLD])
    expect(wrong.code).toBe(2)
    expect(wrong.stderr).toContain('usage: node scripts/sdk-compat.mjs diff')
  })

  it('prints the manifest of the installed SDK', () => {
    const manifest = run(['manifest'])
    expect(manifest.code).toBe(0)
    expect(JSON.parse(manifest.stdout)).toMatchObject({ sdk: expect.any(String) as string, claudeCode: expect.any(String) as string })
  })

  it('runs as a script', () => {
    const result = spawnSync(scriptNode(), [SCRIPT, 'diff', OLD, NEW], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    expect(result.status).toBe(1)
    expect(result.stdout.split('\n')[0]).toBe('SDK 0.3.289 -> 0.3.300, Claude Code 2.1.289 -> 2.1.300')
  })
})
