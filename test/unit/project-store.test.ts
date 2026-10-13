// ProjectStore.onChange: the event the rest of main subscribes to for "the active Project
// switched". A fake GitRunner answers for plain temporary folders, so no git runs here.
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStore, type GitRunner, type ProjectsChange } from '../../src/main/projects/store'
import { removeTestTree } from '../remove'

let scratch: string
let store: ProjectStore
let changes: ProjectsChange[]

/** Every folder is the root of its own repository, on branch main. */
const fakeGit: GitRunner = async (args) => {
  const folder = args[1] ?? ''
  if (args.includes('--show-toplevel')) return folder
  if (args.includes('--git-common-dir')) return join(folder, '.git')
  return 'main'
}

async function addId(name: string): Promise<string> {
  const dir = join(scratch, name)
  mkdirSync(dir)
  const result = await store.add(dir)
  if (result.status !== 'added') throw new Error(result.reason)
  return result.project.id
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-project-store-')))
  store = new ProjectStore(join(scratch, 'data'), fakeGit)
  changes = []
  store.onChange((change) => changes.push(change))
})

afterEach(() => {
  vi.restoreAllMocks()
  removeTestTree(scratch)
})

describe('ProjectStore.onChange', () => {
  it('reports the active Project before and after every add, select and remove, with a growing revision', async () => {
    const a = await addId('a')
    const b = await addId('b')
    store.select(a)
    store.remove(a)
    store.remove(b)
    expect(changes).toStrictEqual([
      { activeId: a, previousActiveId: null, revision: 1 },
      { activeId: b, previousActiveId: a, revision: 2 },
      { activeId: a, previousActiveId: b, revision: 3 },
      // The active one was removed: the first remaining Project becomes active.
      { activeId: b, previousActiveId: a, revision: 4 },
      { activeId: null, previousActiveId: b, revision: 5 },
    ])
  })

  it('reports a change without a switch when the active Project stays the same', async () => {
    const a = await addId('a')
    const b = await addId('b')
    store.remove(a)
    store.select(b)
    expect(changes.slice(2)).toStrictEqual([
      { activeId: b, previousActiveId: b, revision: 3 },
      { activeId: b, previousActiveId: b, revision: 4 },
    ])
  })

  it('stops calling a listener after it unsubscribes, and goes on past a listener that throws', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const late: ProjectsChange[] = []
    const unsubscribe = store.onChange((change) => late.push(change))
    store.onChange(() => {
      throw new Error('a broken subscriber')
    })
    const a = await addId('a')
    unsubscribe()
    store.select(a)
    expect(late).toHaveLength(1)
    expect(changes).toHaveLength(2)
    expect(errors).toHaveBeenCalledTimes(2)
  })

  it('sends nothing for a rejected add or an unknown id', async () => {
    await expect(store.add(join(scratch, 'missing'))).resolves.toMatchObject({ status: 'rejected' })
    expect(() => store.select('nope-00000000')).toThrow(/No Project with id/)
    expect(() => store.remove('nope-00000000')).toThrow(/No Project with id/)
    expect(changes).toEqual([])
  })
})
