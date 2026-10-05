import { spawn } from 'node-pty'
import { describe, expect, it } from 'vitest'

describe('node-pty under the Electron runtime', () => {
  it('spawns /bin/echo in a pseudo-terminal, reads its output and sees it exit', async () => {
    const pty = spawn('/bin/echo', ['ok'], { name: 'xterm-color', cols: 80, rows: 24, env: {} })
    let output = ''
    pty.onData((chunk) => {
      output += chunk
    })
    const exitCode = await new Promise<number>((resolve) => {
      pty.onExit(({ exitCode: code }) => resolve(code))
    })
    expect(exitCode).toBe(0)
    expect(output.trim()).toBe('ok')
  })
})
