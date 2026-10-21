// The store of internal toasts (src/renderer/toast/toasts.ts; worfy-ui ticket 16): how long each kind
// stays, one toast per key, at most three on screen with the oldest self-hiding one pushed out and a
// queue behind three that stay, the pause while the pointer or the keyboard focus is on a toast, and
// a toast of one Project hidden while another is active.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dismissToast, holdToast, MAX_SHOWN, pressToastAction, resetToasts, setToastProject, showToast, shownToasts, TOAST_MS, toasts, type ToastInput } from '../../src/renderer/toast/toasts'

const texts = (): string[] => shownToasts(toasts.getState()).map((toast) => toast.text)
const all = (): string[] => toasts.getState().toasts.map((toast) => toast.text)

const info = (text: string, extra: { key?: string; projectId?: string } = {}): ToastInput => ({ kind: 'info', text, ...extra })
const error = (text: string, extra: { key?: string; projectId?: string } = {}): ToastInput => ({ kind: 'error', text, ...extra })
const action = (text: string): ToastInput => ({ kind: 'action', text, actions: [{ label: 'Undo', run: () => undefined }] })

beforeEach(() => {
  vi.useFakeTimers()
  resetToasts()
})

afterEach(() => {
  resetToasts()
  vi.useRealTimers()
})

describe('time on screen', () => {
  it('info and success hide by themselves after TOAST_MS', () => {
    expect(TOAST_MS).toBe(4000)
    showToast(info('one'))
    showToast({ kind: 'success', text: 'two' })
    vi.advanceTimersByTime(TOAST_MS - 1)
    expect(texts()).toEqual(['one', 'two'])
    vi.advanceTimersByTime(1)
    expect(texts()).toEqual([])
  })

  it('error and action stay until they are closed', () => {
    const failed = showToast(error('failed'))
    const asked = showToast(action('asked'))
    vi.advanceTimersByTime(TOAST_MS * 10)
    expect(texts()).toEqual(['failed', 'asked'])
    dismissToast(failed)
    dismissToast(asked)
    expect(texts()).toEqual([])
  })

  it('an action button runs its handler and closes the toast; a throwing handler still closes it', () => {
    const undo = vi.fn()
    const id = showToast({ kind: 'action', text: 'Archived 3 finished sessions', key: 'batch-1', actions: [{ label: 'Undo', run: undo }] })
    expect(id).toBe('batch-1')
    pressToastAction(id, 0)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(texts()).toEqual([])

    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken = showToast({
      kind: 'action',
      text: 'broken',
      actions: [
        {
          label: 'Go',
          run: () => {
            throw new Error('boom')
          },
        },
      ],
    })
    pressToastAction(broken, 0)
    expect(texts()).toEqual([])
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })
})

describe('one toast per key', () => {
  it('the same key replaces the toast and starts its time again', () => {
    const first = showToast(info('Not undone', { key: 'undo-skipped' }))
    vi.advanceTimersByTime(TOAST_MS - 1)
    const second = showToast(info('Not redone', { key: 'undo-skipped' }))
    expect(second).toBe(first)
    expect(texts()).toEqual(['Not redone'])
    vi.advanceTimersByTime(TOAST_MS - 1)
    expect(texts()).toEqual(['Not redone'])
    vi.advanceTimersByTime(1)
    expect(texts()).toEqual([])
  })

  it('a replaced toast gets a new version, so the component announces it again', () => {
    showToast(error('cannot subscribe', { key: 'ipc:workflow.changed' }))
    const before = toasts.getState().toasts[0]!.version
    showToast(error('cannot subscribe', { key: 'ipc:workflow.changed' }))
    expect(toasts.getState().toasts).toHaveLength(1)
    expect(toasts.getState().toasts[0]!.version).toBe(before + 1)
  })

  it('toasts without a key never replace each other', () => {
    showToast(info('a'))
    showToast(info('a'))
    expect(texts()).toEqual(['a', 'a'])
  })
})

describe('the stack', () => {
  it(`shows at most ${MAX_SHOWN}; a fourth pushes out the oldest self-hiding one`, () => {
    expect(MAX_SHOWN).toBe(3)
    showToast(error('e1'))
    showToast(info('i1'))
    showToast(info('i2'))
    showToast(error('e2'))
    expect(texts()).toEqual(['e1', 'i2', 'e2'])
    expect(all()).toEqual(['e1', 'i2', 'e2'])
  })

  it('a new self-hiding toast does not push itself out: with three that stay it waits', () => {
    showToast(error('e1'))
    showToast(error('e2'))
    showToast(action('a1'))
    const waiting = showToast(info('i1'))
    expect(texts()).toEqual(['e1', 'e2', 'a1'])
    expect(all()).toEqual(['e1', 'e2', 'a1', 'i1'])
    // Its time does not run while it waits.
    vi.advanceTimersByTime(TOAST_MS * 2)
    expect(all()).toContain('i1')
    expect(toasts.getState().toasts.find((toast) => toast.id === waiting)?.waiting).toBe(true)
  })

  it('a waiting toast comes out when a place frees, and its time starts then', () => {
    const e1 = showToast(error('e1'))
    const e2 = showToast(error('e2'))
    showToast(error('e3'))
    showToast(error('e4'))
    showToast(info('i1'))
    expect(texts()).toEqual(['e1', 'e2', 'e3'])
    dismissToast(e1)
    expect(texts()).toEqual(['e2', 'e3', 'e4'])
    dismissToast('nothing-here')
    expect(texts()).toEqual(['e2', 'e3', 'e4'])
    vi.advanceTimersByTime(TOAST_MS * 2)
    dismissToast(e2)
    expect(texts()).toEqual(['e3', 'e4', 'i1'])
    vi.advanceTimersByTime(TOAST_MS - 1)
    expect(texts()).toEqual(['e3', 'e4', 'i1'])
    vi.advanceTimersByTime(1)
    expect(texts()).toEqual(['e3', 'e4'])
  })
})

describe('the pause', () => {
  it('the pointer on a toast stops its time; leaving starts it again in full', () => {
    const id = showToast(info('hover me'))
    vi.advanceTimersByTime(TOAST_MS - 100)
    holdToast(id, 'hover', true)
    vi.advanceTimersByTime(TOAST_MS * 3)
    expect(texts()).toEqual(['hover me'])
    holdToast(id, 'hover', false)
    vi.advanceTimersByTime(TOAST_MS - 1)
    expect(texts()).toEqual(['hover me'])
    vi.advanceTimersByTime(1)
    expect(texts()).toEqual([])
  })

  it('the keyboard focus on a toast stops its time; it runs again only once pointer and focus have both left', () => {
    const id = showToast(info('focus me'))
    holdToast(id, 'focus', true)
    vi.advanceTimersByTime(TOAST_MS * 3)
    expect(texts()).toEqual(['focus me'])
    holdToast(id, 'hover', true)
    holdToast(id, 'focus', false)
    vi.advanceTimersByTime(TOAST_MS * 3)
    expect(texts()).toEqual(['focus me'])
    holdToast(id, 'hover', false)
    vi.advanceTimersByTime(TOAST_MS)
    expect(texts()).toEqual([])
  })
})

describe('the Project of a toast', () => {
  it('a toast with a projectId is shown only while that Project is active', () => {
    setToastProject('alpha')
    showToast(info('of alpha', { projectId: 'alpha' }))
    showToast(info('of beta', { projectId: 'beta' }))
    showToast(info('of none'))
    expect(texts()).toEqual(['of alpha', 'of none'])
    setToastProject('beta')
    expect(texts()).toEqual(['of beta', 'of none'])
    setToastProject(undefined)
    expect(texts()).toEqual(['of none'])
  })

  it('a hidden toast of another Project takes no place in the stack', () => {
    setToastProject('alpha')
    showToast(error('beta 1', { projectId: 'beta' }))
    showToast(error('beta 2', { projectId: 'beta' }))
    showToast(error('beta 3', { projectId: 'beta' }))
    showToast(error('a1'))
    showToast(error('a2'))
    showToast(error('a3'))
    expect(texts()).toEqual(['a1', 'a2', 'a3'])
  })
})
