// One Codex app-server process (src/main/vendors/codex/app-server.ts, worfy-multi-vendor ticket 19), on
// the fake app-server (WORFY_CODEX=fake, which test/setup-contract.ts sets): the start through launch.ts
// without a shell, the handshake `initialize` (clientInfo.name "worfy", no experimentalApi) and
// `initialized`, notifications and server→client requests, a crash that rejects every waiting request
// with the end of stderr, and close(), which waits for the exit.
//
// The fake runs under scriptNode() (test/script-node.ts), with the arguments and environment launch.ts
// gives, through the spawn stand-in of startCodexAppServer: under `pnpm test` process.execPath is
// Electron, which starts far slower under load (see test/contract/codex-fake.test.ts). The fake cannot
// crash by a script, so a crash is a preload module of the test's own (`--import`): it stops the fake
// with exit code 101 and a line on stderr when worfy sends the method WORFY_TEST_CRASH_ON, before the
// fake reads it.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { hasExited } from '../../src/main/agent/session/process'
import { CodexAppServer, CodexAppServerExit, type CodexAppServerOptions } from '../../src/main/vendors/codex/app-server'
import type { CodexRuntime } from '../../src/main/vendors/codex/binary'
import { codexLaunch } from '../../src/main/vendors/codex/launch'
import type { CodexRpcEvent } from '../../src/main/vendors/codex/rpc'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const REPO = join(import.meta.dirname, '..', '..')
const RUNTIME: CodexRuntime = { packaged: false, resourcesPath: '/Resources', platform: process.platform, arch: process.arch }

/** How long the fake may take to send what a test waits for. */
const ANSWER_MS = ms(10_000)

const roots: string[] = []
const servers: CodexAppServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close(0)
  for (const root of roots.splice(0)) removeTestTree(root)
})

function tempRoot(): string {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'worfy-codex-app-server-'))
  roots.push(root)
  return root
}

/** What the spawn stand-in was given. */
interface Spawned {
  file: string
  args: readonly string[]
  options: SpawnOptions
}

/** A preload that stops the fake when worfy sends WORFY_TEST_CRASH_ON, and keeps it alive past its stdin when WORFY_TEST_LINGER is set. */
const PRELOAD = `import process from 'node:process'
const method = process.env.WORFY_TEST_CRASH_ON
if (method) process.stdin.on('data', (chunk) => {
  if (String(chunk).includes('"method":"' + method + '"')) {
    process.stderr.write('panic: the fake app-server crashed on ' + method + '\\n')
    process.exit(101)
  }
})
if (process.env.WORFY_TEST_LINGER) setInterval(() => undefined, 1000)
`

interface Started {
  server: CodexAppServer
  events: CodexRpcEvent[]
  /** The first event `match` takes, now or once it comes. */
  until: (match: (event: CodexRpcEvent) => boolean) => Promise<CodexRpcEvent>
  spawned: Spawned[]
  warnings: string[]
  root: string
  log: string
}

const notification = (method: string) => (event: CodexRpcEvent) => event.type === 'notification' && event.notification.method === method

/** Starts an app-server on the fake playing `script`, with `env` on top of the test's environment. */
async function start(script: string, env: Record<string, string> = {}, options: Partial<CodexAppServerOptions> = {}): Promise<Started> {
  const root = tempRoot()
  const log = join(root, 'codex.log')
  const preload = join(root, 'preload.mjs')
  writeFileSync(preload, PRELOAD)
  const events: CodexRpcEvent[] = []
  let wake = (): void => undefined
  const spawned: Spawned[] = []
  const warnings: string[] = []
  const spawnProcess = (file: string, args: readonly string[], spawnOptions: SpawnOptions): ChildProcess => {
    spawned.push({ file, args, options: spawnOptions })
    return spawn(scriptNode(), ['--import', pathToFileURL(preload).href, ...args], spawnOptions)
  }
  const server = await CodexAppServer.start({
    runtime: RUNTIME,
    appPath: REPO,
    cwd: root,
    clientVersion: '9.9.9',
    env: { ...process.env, WORFY_CODEX_SCRIPT: script, WORFY_CODEX_LOG: log, ...env },
    onEvent: (event) => {
      events.push(event)
      wake()
    },
    log: (line) => warnings.push(line),
    spawnProcess,
    ...options,
  })
  servers.push(server)
  const until = (match: (event: CodexRpcEvent) => boolean) =>
    new Promise<CodexRpcEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no such event in time; the events: ${JSON.stringify(events)}; stderr: ${server.stderr}`)), ANSWER_MS)
      const look = (): void => {
        const found = events.find(match)
        if (found === undefined) return
        clearTimeout(timer)
        resolve(found)
      }
      wake = look
      look()
    })
  return { server, events, until, spawned, warnings, root, log }
}

/** What worfy sent the fake, from its log. */
const loggedBy = (log: string): Record<string, unknown>[] =>
  readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)

describe('CodexAppServer: the start', () => {
  it('starts the fake through launch.ts without a shell, then initialize with clientInfo.name "worfy" and no experimentalApi, then initialized', async () => {
    const { server, spawned, root, log } = await start('turn')
    expect(spawned).toHaveLength(1)
    const [call] = spawned as [Spawned]
    expect(call.args).toEqual(codexLaunch({ runtime: RUNTIME, appPath: REPO }).args)
    expect(call.options).toMatchObject({ cwd: root, stdio: 'pipe', windowsHide: true })
    expect(call.options.shell).toBeUndefined()
    expect(server.initialized).toEqual({ codexHome: '/fake/codex-home', platformFamily: 'unix', platformOs: 'macos', userAgent: 'worfy-fake-app-server/0.166.0' })

    // initialized goes out after the answer to initialize, so the fake has it once it answers the next request.
    await server.request('thread/start', {})
    const [initialize, initialized] = loggedBy(log)
    expect(initialize).toEqual({ id: 1, method: 'initialize', params: { clientInfo: { name: 'worfy', title: 'worfy', version: '9.9.9' }, capabilities: null } })
    expect(JSON.stringify(initialize)).not.toMatch(/experimentalApi/)
    expect(initialized).toEqual({ method: 'initialized' })
  })

  it('plays a turn: the answers find their requests, the notifications come as events, in order', async () => {
    const { server, events, until } = await start('turn')
    const started = await server.request<{ thread: { id: string } }>('thread/start', { cwd: '/fake/project' })
    expect(started.thread.id).toBe('thr_fake_1')
    await expect(server.request('turn/start', { threadId: 'thr_fake_1', input: [{ type: 'text', text: 'Say hello', text_elements: [] }] })).resolves.toMatchObject({ turn: { id: 'turn_1', status: 'inProgress' } })
    await until(notification('turn/completed'))
    expect(events.map((event) => (event.type === 'notification' ? event.notification.method : event.type))).toEqual([
      'thread/started', 'turn/started', 'item/started', 'item/agentMessage/delta', 'item/agentMessage/delta', 'item/completed', 'thread/tokenUsage/updated', 'turn/completed',
    ])
  })

  it('passes a request of the fake on and sends worfy\'s answer back, after which the fake goes on', async () => {
    const { server, until, log } = await start('approval')
    await server.request('thread/start', {})
    await server.request('turn/start', { threadId: 'thr_fake_1', input: [{ type: 'text', text: 'Run the tests', text_elements: [] }] })
    const ask = await until((event) => event.type === 'request')
    if (ask.type !== 'request' || ask.request.method !== 'item/commandExecution/requestApproval') throw new Error(`not an approval: ${JSON.stringify(ask)}`)
    expect(ask.request.params).toMatchObject({ command: 'pnpm test', itemId: 'cmd_1' })
    server.respond(ask.request.id, { decision: 'accept' })
    await until((event) => event.type === 'notification' && event.notification.method === 'item/completed' && JSON.stringify(event.notification.params).includes('"cmd_1"'))
    expect(loggedBy(log)).toContainEqual({ id: ask.request.id, result: { decision: 'accept' } })
  })

  it('rejects the start with the exit code and stderr of a fake that stops before it answers', async () => {
    const error = await start('no-such-script').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CodexAppServerExit)
    expect(error).toMatchObject({ code: 2, signal: null, stderr: expect.stringMatching(/cannot read the script .*no-such-script\.jsonl/) })
    expect((error as Error).message).toMatch(/^Codex app-server exited with code 2; its stderr: fake app-server: cannot read the script/)
  })

  it('never starts the real Codex under vitest, even with an environment of its own that sets neither WORFY_CODEX nor VITEST', async () => {
    const spawned: string[] = []
    const resolvePackage = () => '/node_modules/@openai/codex-darwin-arm64'
    const starting = CodexAppServer.start({
      runtime: RUNTIME,
      appPath: REPO,
      cwd: REPO,
      clientVersion: '9.9.9',
      env: { PATH: process.env.PATH ?? '' },
      resolvePackage,
      onEvent: () => undefined,
      spawnProcess: (file) => {
        spawned.push(file)
        return {} as ChildProcess
      },
    })
    await expect(starting).rejects.toThrow('the real Codex is not started under vitest: set WORFY_CODEX=fake')
    expect(() => codexLaunch({ runtime: RUNTIME, appPath: REPO, env: {}, resolvePackage })).toThrow(/not started under vitest/)
    expect(spawned).toEqual([])
  })
})

describe('CodexAppServer: a crash and the close', () => {
  it('rejects every waiting request when the fake crashes mid-turn, with its exit code and stderr, and every later one at once', async () => {
    const { server, until } = await start('steer', { WORFY_TEST_CRASH_ON: 'turn/steer' })
    await server.request('thread/start', {})
    await server.request('turn/start', { threadId: 'thr_fake_1', input: [{ type: 'text', text: 'Work', text_elements: [] }] })
    await until(notification('item/agentMessage/delta'))

    const steer = server.request('turn/steer', { threadId: 'thr_fake_1', expectedTurnId: 'turn_1', input: [{ type: 'text', text: 'Note', text_elements: [] }] }).catch((error: unknown) => error)
    const account = server.request('account/read', { refreshToken: false }).catch((error: unknown) => error)
    const [first, second] = await Promise.all([steer, account])
    expect(first).toBeInstanceOf(CodexAppServerExit)
    expect(second).toBe(first)
    expect(first).toMatchObject({ code: 101, signal: null })
    expect((first as Error).message).toBe('Codex app-server exited with code 101; its stderr: panic: the fake app-server crashed on turn/steer')
    expect(server.stderr).toBe('panic: the fake app-server crashed on turn/steer\n')
    await expect(server.request('thread/start', {})).rejects.toBe(first)
  })

  it('close() ends stdin and settles only once the fake has exited; a waiting request learns of the close', async () => {
    const { server } = await start('turn')
    const waiting = server.request('account/read', { refreshToken: false }).catch((error: unknown) => error)
    const closing = server.close()
    expect(hasExited(server.process)).toBe(false)
    await closing
    expect(hasExited(server.process)).toBe(true)
    expect(server.process.exitCode).toBe(0)
    expect(((await waiting) as Error).message).toBe('the Codex app-server was closed')
    // A second close waits for the same exit.
    await expect(server.close()).resolves.toBeUndefined()
  })

  it('close() kills a fake that outlives its stdin, after the time it was given', async () => {
    const { server, warnings } = await start('turn', { WORFY_TEST_LINGER: '1' })
    const began = Date.now()
    await server.close(200)
    expect(hasExited(server.process)).toBe(true)
    expect(Date.now() - began).toBeGreaterThanOrEqual(190)
    expect(warnings).toEqual([expect.stringMatching(/did not exit 200 ms after its stdin was closed; sending SIGKILL$/)])
  })
})
