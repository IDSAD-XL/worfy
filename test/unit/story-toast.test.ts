// The toast "Story of the Epic is ready" (worfy-code-stories ticket 10, decision 7): pure functions over the real toast
// store (src/renderer/toast/toasts.ts), with the opener and the storage handed in by the test, as the toast of a stopped
// Run is tested (flight-recorder-stop-toast.test.ts). One toast per Epic, the first time worfy sees its story.md; the
// fact that it was shown is kept in the storage, so a restart of worfy shows none; a PR story never gives one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Epic } from '../../src/shared/workflow/types'
import { pressToastAction, resetToasts, toasts } from '../../src/renderer/toast/toasts'
import { acceptStoryEpics, resetStoryToasts, setStoryToastTarget, STORY_TOAST_ITEM, STORY_TOAST_TEST_ID, storyToastKey } from '../../src/renderer/stories/story-toast'

const PROJECT = 'demo-000000c5'

/** An Epic of the model with the stories it names. */
function epic(name: string, stories: { kind: 'pr' | 'epic'; file: string }[] = []): Epic {
  return {
    epic: name,
    hasSpec: true,
    hasMap: false,
    title: null,
    ...(stories.length === 0 ? {} : { stories: stories.map(({ kind, file }) => ({ kind, path: `${name}/${file}`, ticket: kind === 'pr' ? file.slice(8, 10) : null, version: 'v1' })) }),
  }
}

/** A storage in memory, the shape the toasts take of localStorage. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { items: Map<string, string> } {
  const items = new Map<string, string>()
  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) }
}

const shown = () => toasts.getState().toasts.filter((toast) => toast.testId === STORY_TOAST_TEST_ID)

let storage: ReturnType<typeof memoryStorage>
const open = vi.fn<(projectId: string, epic: string) => void>()

beforeEach(() => {
  storage = memoryStorage()
  setStoryToastTarget(open, storage)
})

afterEach(() => {
  resetStoryToasts()
  resetToasts()
  open.mockReset()
})

describe('the toast of an Epic story', () => {
  it('the first model of a Project only remembers the stories it already has: no toast for them', () => {
    acceptStoryEpics(PROJECT, [epic('cart', [{ kind: 'epic', file: 'story.md' }]), epic('billing')])
    expect(shown()).toEqual([])
    acceptStoryEpics(PROJECT, [epic('cart', [{ kind: 'epic', file: 'story.md' }]), epic('billing')])
    expect(shown()).toEqual([])
  })

  it('the first appearance of story.md gives one toast, "Open" opens the story of that Epic', () => {
    acceptStoryEpics(PROJECT, [epic('cart')])
    acceptStoryEpics(PROJECT, [epic('cart', [{ kind: 'epic', file: 'story.md' }])])
    const [toast, ...rest] = shown()
    expect(rest).toEqual([])
    expect(toast).toMatchObject({ kind: 'action', key: storyToastKey(PROJECT, 'cart'), projectId: PROJECT, text: 'The Code story of Epic cart is ready' })
    expect(toast!.actions?.map((action) => action.label)).toEqual(['Open'])
    pressToastAction(toast!.id, 0)
    expect(open).toHaveBeenCalledWith(PROJECT, 'cart')
  })

  it('a second read of the same Epic shows none, after the toast is closed too', () => {
    acceptStoryEpics(PROJECT, [epic('cart')])
    acceptStoryEpics(PROJECT, [epic('cart', [{ kind: 'epic', file: 'story.md' }])])
    resetToasts()
    acceptStoryEpics(PROJECT, [epic('cart', [{ kind: 'epic', file: 'story.md' }])])
    expect(shown()).toEqual([])
  })

  it('a restart of worfy shows none: the shown fact is in the storage', () => {
    acceptStoryEpics(PROJECT, [epic('cart')])
    acceptStoryEpics(PROJECT, [epic('cart', [{ kind: 'epic', file: 'story.md' }])])
    expect(shown()).toHaveLength(1)
    expect(JSON.parse(storage.getItem(STORY_TOAST_ITEM)!)).toEqual({ [PROJECT]: ['cart'] })
    // A new window: the module forgets, the storage stays.
    resetStoryToasts()
    resetToasts()
    setStoryToastTarget(open, storage)
    acceptStoryEpics(PROJECT, [epic('cart', [{ kind: 'epic', file: 'story.md' }])])
    expect(shown()).toEqual([])
  })

  it('a new stories/*.md shows none: a PR story gives no notice (decision 7)', () => {
    acceptStoryEpics(PROJECT, [epic('cart')])
    acceptStoryEpics(PROJECT, [epic('cart', [{ kind: 'pr', file: 'stories/04-cart-total.md' }])])
    expect(shown()).toEqual([])
  })

  it('each Epic once: a second Epic gets its own toast; another Project starts by remembering', () => {
    acceptStoryEpics(PROJECT, [epic('cart'), epic('billing')])
    acceptStoryEpics(PROJECT, [epic('cart', [{ kind: 'epic', file: 'story.md' }]), epic('billing', [{ kind: 'epic', file: 'story.md' }])])
    expect(shown().map((toast) => toast.key)).toEqual([storyToastKey(PROJECT, 'cart'), storyToastKey(PROJECT, 'billing')])
    acceptStoryEpics('other-0000000d', [epic('cart', [{ kind: 'epic', file: 'story.md' }])])
    expect(shown()).toHaveLength(2)
  })

  it('a storage that cannot be used keeps the toasts once per window', () => {
    const broken = { getItem: () => { throw new Error('no storage') }, setItem: () => { throw new Error('no storage') } }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    setStoryToastTarget(open, broken)
    acceptStoryEpics(PROJECT, [epic('cart')])
    acceptStoryEpics(PROJECT, [epic('cart', [{ kind: 'epic', file: 'story.md' }])])
    acceptStoryEpics(PROJECT, [epic('cart', [{ kind: 'epic', file: 'story.md' }])])
    expect(shown()).toHaveLength(1)
    error.mockRestore()
  })
})
