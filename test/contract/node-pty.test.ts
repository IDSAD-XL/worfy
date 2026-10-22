import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { spawn } from 'node-pty'
import { describe, expect, it } from 'vitest'

// Windows has no /bin/echo: echo is built into cmd.exe there, and cmd.exe needs SystemRoot to start.
// ConPTY also draws the screen with escape sequences around the output, so those are stripped.
const windows = process.platform === 'win32'
const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows'
const [file, args, env] = windows
  ? [process.env['ComSpec'] ?? `${systemRoot}\\System32\\cmd.exe`, ['/c', 'echo ok'], { SystemRoot: systemRoot }]
  : ['/bin/echo', ['ok'], {}]

describe('node-pty under the Electron runtime', () => {
  it('spawns echo in a pseudo-terminal, reads its output and sees it exit', async () => {
    const pty = spawn(file, args, { name: 'xterm-color', cols: 80, rows: 24, env })
    let output = ''
    pty.onData((chunk) => {
      output += chunk
    })
    const exitCode = await new Promise<number>((resolve) => {
      pty.onExit(({ exitCode: code }) => resolve(code))
    })
    expect(exitCode).toBe(0)
    expect(stripVTControlCharacters(output).trim()).toBe('ok')
  })
})

// What the Terminal registry reads of node-pty's private parts on Windows (src/main/terminal/windows-pty.ts).
// lib/*.js load on any system: their native part is asked for only when a pty starts, so these run
// on the Mac and on Linux too. When one fails after an update of node-pty, read the function it
// names in windows-pty.ts again (worfy-windows ticket 42, item 2).
describe('node-pty as the registry knows it', () => {
  const required = createRequire(import.meta.url)
  type Prototype = Record<string, unknown>
  const { WindowsPtyAgent } = required('node-pty/lib/windowsPtyAgent.js') as { WindowsPtyAgent: { prototype: Prototype } }
  const getter = (prototype: Prototype, name: string): string => String(Object.getOwnPropertyDescriptor(prototype, name)?.get ?? 'no getter')

  it('still has the private helper that the registry takes out of kill() on Windows, and kill() still calls it (withoutConsoleHelper)', () => {
    expect(typeof WindowsPtyAgent.prototype['_getConsoleProcessList']).toBe('function')
    expect(String(WindowsPtyAgent.prototype['kill'])).toContain('this._getConsoleProcessList()')
  })

  it('still drops the pending connection in its own kill() and tests it as falsy, as killUnconnected reads it', () => {
    expect(String(WindowsPtyAgent.prototype['kill'])).toContain('this._pendingPtyInfo = undefined')
    expect(String(WindowsPtyAgent.prototype['_completePtyConnection'])).toContain('if (!this._pendingPtyInfo)')
  })

  it('the terminal of Windows keeps its agent as _agent, which every reader goes through', () => {
    const { WindowsTerminal } = required('node-pty/lib/windowsTerminal.js') as { WindowsTerminal: unknown }
    expect(String(WindowsTerminal)).toContain('_this._agent = new windowsPtyAgent_1.WindowsPtyAgent(')
  })

  it('the agent still has the exit code as a getter over the field its native exit sets (exitCodeKnown)', () => {
    expect(getter(WindowsPtyAgent.prototype, 'exitCode')).toContain('return this._exitCode')
    expect(String(WindowsPtyAgent.prototype['_$onProcessExit'])).toContain('this._exitCode = exitCode')
  })

  it('the agent still has its input socket as the getter inSocket (spawnShellPty listens to its errors)', () => {
    expect(getter(WindowsPtyAgent.prototype, 'inSocket')).toContain('return this._inSocket')
    expect(String(WindowsPtyAgent)).toContain('this._inSocket = new net_1.Socket(')
  })

  it('the agent still keeps the thread that reads the output as _conoutSocketWorker, with dispose() (stopOutputWorker)', () => {
    expect(String(WindowsPtyAgent)).toContain('this._conoutSocketWorker = options.conoutConnectionFactory(')
    const { ConoutConnection } = required('node-pty/lib/windowsConoutConnection.js') as { ConoutConnection: { prototype: Prototype } }
    expect(typeof ConoutConnection.prototype['dispose']).toBe('function')
    // The factory the agent is made with by default (defaultWindowsPtyAgentOptions) makes that class.
    expect(readFileSync(required.resolve('node-pty/lib/windowsPtyAgent.js'), 'utf8')).toContain('return new windowsConoutConnection_1.ConoutConnection(conoutPipeName, useConptyDll)')
  })

  it('the package still has the console the registry starts shells on: conpty.dll and OpenConsole.exe of win32-x64 (spawnShellPty)', () => {
    const conpty = join(dirname(required.resolve('node-pty/package.json')), 'prebuilds', 'win32-x64', 'conpty')
    expect([existsSync(join(conpty, 'conpty.dll')), existsSync(join(conpty, 'OpenConsole.exe'))]).toEqual([true, true])
  })
})
