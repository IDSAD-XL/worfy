// InputQueue (src/main/agent/session/input-queue.ts): the async queue a Claude SessionHandle gives
// its Session events through. fail() ends it with the reason the agent is gone: what was pushed
// before still comes out, then the iteration throws that reason, not a plain end.
import { describe, expect, it } from 'vitest'
import { InputQueue } from '../../src/main/agent/session/input-queue'

describe('InputQueue.fail', () => {
  it('yields the items pushed before the failure, then throws the failure itself', async () => {
    const queue = new InputQueue<string>()
    const error = new Error('Claude Code process exited with code 1')
    queue.push('a')
    queue.push('b')
    queue.fail(error)
    const got: string[] = []
    let thrown: unknown = null
    try {
      for await (const item of queue) got.push(item)
    } catch (caught) {
      thrown = caught
    }
    expect(got).toEqual(['a', 'b'])
    expect(thrown).toBe(error)
  })

  it('rejects a next() already waiting with the failure', async () => {
    const queue = new InputQueue<string>()
    const error = new Error('the agent died')
    const waiting = queue[Symbol.asyncIterator]().next()
    queue.fail(error)
    await expect(waiting).rejects.toBe(error)
  })

  it('rejects the next next() with the failure when nobody waited, and every one after it', async () => {
    const queue = new InputQueue<string>()
    const error = new Error('the agent died')
    queue.fail(error)
    const iterator = queue[Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toBe(error)
    await expect(iterator.next()).rejects.toBe(error)
  })

  it('takes nothing after the failure, and a later end() or fail() does not replace it', async () => {
    const queue = new InputQueue<string>()
    const error = new Error('first')
    queue.push('a')
    queue.fail(error)
    queue.push('late')
    queue.end()
    queue.fail(new Error('second'))
    const iterator = queue[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ value: 'a', done: false })
    await expect(iterator.next()).rejects.toBe(error)
  })

  it('a failure after end() changes nothing: the iteration just ends', async () => {
    const queue = new InputQueue<string>()
    queue.push('a')
    queue.end()
    queue.fail(new Error('too late'))
    const got: string[] = []
    for await (const item of queue) got.push(item)
    expect(got).toEqual(['a'])
  })
})
