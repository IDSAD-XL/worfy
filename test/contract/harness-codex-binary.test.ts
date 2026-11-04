// worfy-polish ticket 54: `harness.codexBinary` answers the step "Approve the Harness hooks in Codex"
// with the Codex binary worfy installs the Harness into Codex with (codexInstallBinary of
// src/main/harness/codex-install.ts): WORFY_CODEX_CLI when set, else the binary this build pins. The
// user has no `codex` on PATH, so step 1 of the dialog shows this path. Over a mocked `electron`; the
// handler only reads the environment, runs nothing and writes nothing.
import type { IpcMainInvokeEvent } from 'electron'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { registerIpc, type ModuleLoader } from '../../src/main/ipc/index'
import { accessOf, IPC_CHANNEL_PREFIX, type IpcResult } from '../../src/shared/ipc/channels'
import { removeTestTree } from '../remove'

const env = await vi.hoisted(async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worfy-harness-codex-binary-')))
  // A sandbox: no path reaches the real ~/.claude or ~/.codex.
  process.env.WORFY_CLAUDE_HOME = path.join(scratch, 'claude')
  process.env.WORFY_HARNESS_HOME = path.join(scratch, 'harness')
  process.env.WORFY_DATA_DIR = path.join(scratch, 'data')
  process.env.CODEX_HOME = path.join(scratch, 'codex-home')
  return { scratch }
})

afterAll(() => removeTestTree(env.scratch))
afterEach(() => vi.unstubAllEnvs())

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
}))

const modules: Record<string, ModuleLoader> = {
  './harness.ts': () => import('../../src/main/ipc/harness').then((module) => module.default),
}

async function call(channel: string): Promise<IpcResult<unknown>> {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
  await registerIpc({ handle: (name, listener) => handlers.set(name, listener) }, { modules, isTrustedSender: () => true })
  const listener = handlers.get(IPC_CHANNEL_PREFIX + channel)
  if (!listener) throw new Error(`${channel} is not registered`)
  const event = { senderFrame: { url: 'app://index.html' }, sender: {} } as unknown as IpcMainInvokeEvent
  return (await listener(event, undefined)) as IpcResult<unknown>
}

describe('harness.codexBinary', () => {
  it('is `local`: the binary is the one of the machine the window runs on', async () => {
    await import('../../src/shared/ipc/harness')
    expect(accessOf('harness.codexBinary')).toBe('local')
  })

  it('answers the binary worfy installs into Codex with, and whether the command is for PowerShell', async () => {
    const binary = '/Applications/worfy.app/Contents/Resources/app.asar.unpacked/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex'
    vi.stubEnv('WORFY_CODEX_CLI', binary)
    expect(await call('harness.codexBinary')).toEqual({ ok: true, value: { path: binary, windows: process.platform === 'win32' } })
  })

  it('answers null when there is none (here: under vitest without a stand-in, where no test reaches the real Codex)', async () => {
    vi.stubEnv('WORFY_CODEX_CLI', '')
    expect(await call('harness.codexBinary')).toEqual({ ok: true, value: { path: null, windows: process.platform === 'win32' } })
  })

  it('answers null under WORFY_CODEX=absent, a build without Codex', async () => {
    vi.stubEnv('WORFY_CODEX_CLI', '')
    vi.stubEnv('WORFY_CODEX', 'absent')
    expect(await call('harness.codexBinary')).toEqual({ ok: true, value: { path: null, windows: process.platform === 'win32' } })
  })
})
