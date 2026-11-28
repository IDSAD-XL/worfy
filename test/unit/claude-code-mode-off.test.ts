// Claude Code 2.1.332 (Agent SDK 0.3.332) has an experimental "Code Mode", and an Agent SDK app turns
// it on only through the environment block of the SDK's `settings` option
// (CLAUDE_CODE_EXPERIMENTAL_CODE_MODE). worfy does not turn it on (worfy-polish ticket 175): none of the
// query options it builds names that variable, neither in `settings.env` nor in `env`.
import { describe, expect, it, vi } from 'vitest'
import { draftSessionOptions, harnessCheckOptions, inventoryOptions, sessionOptions, type RuntimeInfo, type SessionOptionsInput } from '../../src/main/vendors/claude/options'

vi.mock('../../src/main/harness/bundled', () => ({ bundledHarnessDir: vi.fn(() => '/Applications/worfy.app/Contents/Resources/harness') }))

const CODE_MODE = 'CLAUDE_CODE_EXPERIMENTAL_CODE_MODE'
const runtime: RuntimeInfo = { packaged: true, resourcesPath: '/Applications/worfy.app/Contents/Resources', platform: 'darwin', arch: 'arm64' }
const env = { PATH: '/usr/bin', HOME: '/Users/someone' }
const input = (more: Partial<SessionOptionsInput> = {}): SessionOptionsInput => ({ cwd: '/repo', env, runtime, ...more })

/** Every place of the options where the variable could go: the flag settings' env and the process env. */
function codeModeIn(options: { settings?: unknown; env?: Record<string, string | undefined> }): string[] {
  const found: string[] = []
  const settings = typeof options.settings === 'string' ? (JSON.parse(options.settings) as unknown) : options.settings
  const settingsEnv = (settings as { env?: Record<string, unknown> } | undefined)?.env
  if (settingsEnv !== undefined && Object.keys(settingsEnv).some((key) => key.startsWith(CODE_MODE))) found.push('settings.env')
  if (options.env !== undefined && Object.keys(options.env).some((key) => key.startsWith(CODE_MODE))) found.push('env')
  return found
}

describe('worfy never turns on Claude Code’s Code Mode (worfy-polish ticket 175)', () => {
  it.each([
    ['an ordinary Session', input()],
    ['an unattended Session', input({ unattended: true })],
    ['a Session in a Project with an MCP list', input({ mcpAllowlist: [] })],
    ['a Product Session', input({ kind: 'product' })],
    ['a Session of a Wave', input({ epic: 'worfy-polish' })],
  ])('sessionOptions of %s', (_name, given) => {
    expect(codeModeIn(sessionOptions(given))).toEqual([])
  })

  it('draftSessionOptions, inventoryOptions and harnessCheckOptions', () => {
    expect(codeModeIn(draftSessionOptions({ cwd: '/repo', env, runtime, persistSession: false }))).toEqual([])
    expect(codeModeIn(inventoryOptions({ cwd: '/worfy', env, runtime, disabled: ['server-1'] }))).toEqual([])
    expect(codeModeIn(harnessCheckOptions({ cwd: '/worfy', env, runtime, harnessPlugin: '/harness' }))).toEqual([])
  })

  it('the check itself finds the variable in either place', () => {
    expect(codeModeIn({ settings: { env: { [CODE_MODE]: '1' } } })).toEqual(['settings.env'])
    expect(codeModeIn({ settings: JSON.stringify({ env: { [CODE_MODE]: '1' } }) })).toEqual(['settings.env'])
    expect(codeModeIn({ env: { ...env, [CODE_MODE]: '1' } })).toEqual(['env'])
  })
})
