// A stdout or stderr nobody reads any more must not stop main (src/main/diagnostics/closed-stdio.ts):
// the errors of a closed stream and EIO are dropped, any other stream error stays uncaught.
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { ignoreClosedStdio, isClosedStreamError } from '../../src/main/diagnostics/closed-stdio'

const withCode = (code: string): Error => Object.assign(new Error(`write ${code}`), { code })

describe('isClosedStreamError', () => {
  it('knows the codes of a stream whose reader has gone', () => {
    expect(isClosedStreamError(withCode('EPIPE'))).toBe(true)
    expect(isClosedStreamError(withCode('EOF'))).toBe(true)
    expect(isClosedStreamError(withCode('ERR_STREAM_DESTROYED'))).toBe(true)
    expect(isClosedStreamError(withCode('EIO'))).toBe(true)
  })

  it('does not take any other error for one', () => {
    expect(isClosedStreamError(withCode('ENOSPC'))).toBe(false)
    expect(isClosedStreamError(withCode('EBADF'))).toBe(false)
    expect(isClosedStreamError(new Error('EPIPE'))).toBe(false)
    expect(isClosedStreamError(null)).toBe(false)
    expect(isClosedStreamError('EPIPE')).toBe(false)
  })
})

describe('ignoreClosedStdio', () => {
  it('drops the error of a closed stream on every stream it is given', () => {
    const out = new EventEmitter()
    const err = new EventEmitter()
    ignoreClosedStdio([out, err])
    expect(() => out.emit('error', withCode('EPIPE'))).not.toThrow()
    expect(() => err.emit('error', withCode('EPIPE'))).not.toThrow()
    expect(() => out.emit('error', withCode('ERR_STREAM_DESTROYED'))).not.toThrow()
    expect(() => err.emit('error', withCode('EIO'))).not.toThrow()
  })

  it('throws any other stream error on, as the stream would with no listener', () => {
    const out = new EventEmitter()
    const enospc = withCode('ENOSPC')
    ignoreClosedStdio([out])
    expect(() => out.emit('error', enospc)).toThrow(enospc)
  })

  it('listens to process.stdout and process.stderr by default', () => {
    const streams = [process.stdout, process.stderr]
    const before = streams.map((stream) => new Set(stream.listeners('error')))
    ignoreClosedStdio()
    const added = streams.map((stream, i) => stream.listeners('error').filter((listener) => !before[i]!.has(listener)))
    for (const [i, stream] of streams.entries()) for (const listener of added[i]!) stream.removeListener('error', listener as (error: Error) => void)
    expect(added.map((listeners) => listeners.length)).toEqual([1, 1])
  })
})
