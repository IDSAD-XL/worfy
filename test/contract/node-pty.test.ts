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
