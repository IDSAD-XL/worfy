// A failed write to stdout or stderr must not stop main (src/main/diagnostics/closed-stdio.ts): every
// error of the two streams is dropped, whatever its code.
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { dropStdioError, ignoreStdioErrors } from '../../src/main/diagnostics/closed-stdio'

const withCode = (code: string): Error => Object.assign(new Error(`write ${code}`), { code })

describe('ignoreStdioErrors', () => {
  // EPIPE: a pipe whose reader has gone; EIO: a terminal that hung up; EAGAIN and EBADF: a Windows
  // console whose owner has gone (ERROR_NO_DATA, ERROR_INVALID_HANDLE); ENOSPC: a full disk under a
  // redirected stdout.
  it.each(['EPIPE', 'EIO', 'EAGAIN', 'EBADF', 'ENOSPC'])('drops a write error with code %s on every stream it is given', (code) => {
    const out = new EventEmitter()
    const err = new EventEmitter()
    ignoreStdioErrors([out, err])
    expect(() => out.emit('error', withCode(code))).not.toThrow()
    expect(() => err.emit('error', withCode(code))).not.toThrow()
  })

  it('drops an error with no code too', () => {
    const out = new EventEmitter()
    ignoreStdioErrors([out])
    expect(() => out.emit('error', new Error('no code'))).not.toThrow()
  })

  it('puts dropStdioError on process.stdout and process.stderr by default', () => {
    const streams = [process.stdout, process.stderr]
    const before = streams.map((stream) => stream.listeners('error').filter((listener) => listener === dropStdioError).length)
    ignoreStdioErrors()
    const after = streams.map((stream) => stream.listeners('error').filter((listener) => listener === dropStdioError).length)
    for (const stream of streams) stream.removeListener('error', dropStdioError)
    expect(after).toEqual(before.map((count) => count + 1))
  })
})
