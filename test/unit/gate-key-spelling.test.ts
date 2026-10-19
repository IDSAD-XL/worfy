import { describe, expect, it, vi } from 'vitest'
import { gateKey } from '../../src/main/gate/state'

// gateKey must pick the registry entry the way gate-resolve.mjs --which does (its onDisk), or the
// Gate writes `red-<key>-<tag>` under a key the app never looks for. Windows has spellings of one
// folder that are not links: an 8.3 short name (the runner's TEMP, C:\Users\RUNNER~1) and a `subst`
// drive. realpath(3) expands them; the plain realpath keeps them, and follows links. node:fs is
// faked here with the answers Windows gives, so these run on macOS and Linux too.
const answers = vi.hoisted(() => {
  const folders: Record<string, { native: string; plain: string }> = {
    // an 8.3 short name
    'C:\\Users\\RUNNER~1\\worfy': { native: 'C:\\Users\\runneradmin\\worfy', plain: 'C:\\Users\\RUNNER~1\\worfy' },
    // a `subst` drive, written with `/`
    'W:/worfy': { native: 'C:\\Users\\x\\tmp-alias\\worfy', plain: 'W:\\worfy' },
    // a junction: both realpaths follow it
    'C:\\link\\worfy': { native: 'C:\\Users\\x\\worfy', plain: 'C:\\Users\\x\\worfy' },
  }
  return folders
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  type Callback = (error: NodeJS.ErrnoException | null, resolved?: string) => void
  const answer = (kind: 'native' | 'plain') => (path: string, ...rest: unknown[]) => {
    const callback = rest[rest.length - 1] as Callback
    const known = answers[path]
    if (known === undefined) callback(Object.assign(new Error(`ENOENT: no such file or directory, realpath '${path}'`), { code: 'ENOENT' }))
    else callback(null, known[kind])
  }
  return { ...actual, realpath: Object.assign(answer('plain'), { native: answer('native') }) }
})

describe('gateKey with a `match` the gate expands', () => {
  it('on Windows takes the long spelling of a `match` written with an 8.3 short name', async () => {
    const config = { repos: [{ key: 'short', match: 'C:\\Users\\RUNNER~1\\worfy' }] }
    expect(await gateKey(config, 'C:/Users/runneradmin/worfy', 'win32')).toBe('short')
    expect(await gateKey(config, 'C:/Users/runneradmin/worfy/.claude/worktrees/07', 'win32')).toBe('short')
  })

  it('on Windows takes the target folder of a `match` on a `subst` drive', async () => {
    const config = { repos: [{ key: 'subst', match: 'W:/worfy' }] }
    expect(await gateKey(config, 'C:\\Users\\x\\tmp-alias\\worfy', 'win32')).toBe('subst')
  })

  it('keeps a `match` that goes through a link as written, as the gate does', async () => {
    const config = { repos: [{ key: 'linked', match: 'C:\\link\\worfy' }] }
    expect(await gateKey(config, 'C:\\Users\\x\\worfy', 'win32')).toBeNull()
  })

  it('off Windows keeps a `match` that differs by more than letter case as written', async () => {
    const config = { repos: [{ key: 'short', match: 'C:\\Users\\RUNNER~1\\worfy' }] }
    expect(await gateKey(config, 'C:\\Users\\runneradmin\\worfy', 'darwin')).toBeNull()
  })
})
