// The environment of the Claude Code process (ADR-0007): a real interactive login shell, run with
// a temporary HOME whose rc file stands in for the user's.
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { captureLoginShellEnv, ENV_END_MARKER, ENV_START_MARKER, parseEnvDump, shellBaseEnv, SYSTEM_PATH, withoutApiKeys } from '../../src/main/agent/env'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'worfy-env-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** worfy's own environment as a test sets it: a temporary HOME and whatever else is given. */
function worfyEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { HOME: home, USER: 'tester', SHELL: '/bin/zsh', LANG: 'en_US.UTF-8', ...extra }
}

async function zshrc(content: string): Promise<void> {
  await writeFile(join(home, '.zshrc'), content)
}

// Cases marked onMac run a real /bin/zsh: macOS has it, the Linux CI runner does not. The Mac runs
// them in every gate.
const onMac = it.skipIf(process.platform !== 'darwin')

describe('captureLoginShellEnv', () => {
  onMac('removes ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN even when worfy itself has them', async () => {
    await zshrc('export ANTHROPIC_API_KEY=from-rc\nexport ANTHROPIC_AUTH_TOKEN=from-rc\n')
    const result = await captureLoginShellEnv({
      shell: '/bin/zsh',
      source: worfyEnv({ ANTHROPIC_API_KEY: 'worfy-own-key', ANTHROPIC_AUTH_TOKEN: 'worfy-own-token' }),
    })
    expect(result.from).toBe('login-shell')
    expect(result.env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(result.env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
    expect(JSON.stringify(result.env)).not.toContain('worfy-own-key')
  })

  onMac("keeps the user's own ANTHROPIC_* and CLAUDE_CODE_* variables from the rc file", async () => {
    await zshrc('export ANTHROPIC_MODEL=opus\nexport CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000\nexport PATH="$HOME/bin:$PATH"\n')
    const { env } = await captureLoginShellEnv({ shell: '/bin/zsh', source: worfyEnv() })
    expect(env.ANTHROPIC_MODEL).toBe('opus')
    expect(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('64000')
    // ~/.zshrc is read: the shell is interactive (-i), as nvm needs.
    expect(env.PATH?.split(':')[0]).toBe(join(home, 'bin'))
  })

  onMac('does not pass the variables of whoever started worfy into the shell', async () => {
    const { env } = await captureLoginShellEnv({
      shell: '/bin/zsh',
      source: worfyEnv({ CLAUDE_CODE_SESSION_ID: 'parent-session', ANTHROPIC_BASE_URL: 'http://proxy', PATH: '/parent/bin:/usr/bin' }),
    })
    expect(env).not.toHaveProperty('CLAUDE_CODE_SESSION_ID')
    expect(env).not.toHaveProperty('ANTHROPIC_BASE_URL')
    expect(env.PATH).not.toContain('/parent/bin')
    expect(env.HOME).toBe(home)
  })

  onMac('keeps a value with a newline whole and ignores what the rc file prints', async () => {
    await zshrc("echo 'banner from zshrc'\nexport MULTI=$'line one\\nFAKE=line two'\n")
    const { env } = await captureLoginShellEnv({ shell: '/bin/zsh', source: worfyEnv() })
    expect(env.MULTI).toBe('line one\nFAKE=line two')
    expect(env).not.toHaveProperty('FAKE')
    expect(Object.keys(env).some((key) => key.includes('banner'))).toBe(false)
  })

  it('falls back to the minimal environment, without API keys, when the shell hangs past the timeout', async () => {
    const shell = join(home, 'slow-shell')
    await writeFile(shell, '#!/bin/sh\nsleep 5\n')
    await chmod(shell, 0o755)
    const started = Date.now()
    const result = await captureLoginShellEnv({ shell, source: worfyEnv({ ANTHROPIC_API_KEY: 'k' }), timeoutMs: 300 })
    expect(Date.now() - started).toBeLessThan(3000)
    expect(result.from).toBe('fallback')
    expect(result.error).toMatch(/slow-shell -ilc failed/)
    expect(result.env).toEqual({ PATH: SYSTEM_PATH, HOME: home, USER: 'tester', SHELL: '/bin/zsh', LANG: 'en_US.UTF-8' })
  })

  it('falls back when the shell does not exist', async () => {
    const result = await captureLoginShellEnv({ shell: join(home, 'no-such-shell'), source: worfyEnv() })
    expect(result.from).toBe('fallback')
    expect(result.env.PATH).toBe(SYSTEM_PATH)
  })
})

describe('environment helpers', () => {
  it('starts the shell with the user variables and the system PATH only', () => {
    expect(shellBaseEnv({ HOME: '/h', USER: 'u', PATH: '/x', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_SESSION_ID: 's' })).toEqual({ PATH: SYSTEM_PATH, HOME: '/h', USER: 'u' })
  })

  it('reads only the entries between the markers', () => {
    const dump = ['noise', ENV_START_MARKER, 'A=1', 'B=x=y', 'C=line\nnext', ENV_END_MARKER, 'TAIL=1', ''].join('\0')
    expect(parseEnvDump(dump)).toEqual({ A: '1', B: 'x=y', C: 'line\nnext' })
    expect(parseEnvDump('A=1\0')).toBeNull()
  })

  it('removes exactly the two API key variables', () => {
    expect(withoutApiKeys({ ANTHROPIC_API_KEY: 'a', ANTHROPIC_AUTH_TOKEN: 'b', ANTHROPIC_MODEL: 'm', PATH: '/p' })).toEqual({ ANTHROPIC_MODEL: 'm', PATH: '/p' })
  })
})
