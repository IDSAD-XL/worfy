// What worfy starts for a program an override variable may name in its place (src/main/program.ts):
// a `.mjs` override is a Node script and runs under worfy's own Node; any other override, and the
// usual program when nothing overrides it, start as they are. The same on every system.
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { programStart } from '../../src/main/program'

const NODE = '/Applications/worfy.app/Contents/MacOS/worfy'

describe('programStart', () => {
  it.each(['/repo/test/fixtures/gh/gh-stub.mjs', 'C:\\repo\\test\\fixtures\\gh\\gh-stub.mjs'])('an override that ends in .mjs runs as a script of worfy\'s own Node: %s', (script) => {
    expect(programStart(script, 'gh', NODE)).toEqual({ file: NODE, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } })
  })

  it('a relative .mjs override is resolved against worfy\'s own folder: the child runs in another one', () => {
    expect(programStart(join('test', 'fixtures', 'gh', 'gh-stub.mjs'), 'gh', NODE).args).toEqual([resolve('test', 'fixtures', 'gh', 'gh-stub.mjs')])
  })

  it('the Node of a .mjs override is the one worfy itself runs in', () => {
    expect(programStart('/stub/gh.mjs', 'gh').file).toBe(process.execPath)
  })

  it.each(['gh', '/opt/homebrew/bin/gh', 'C:\\Program Files\\GitHub CLI\\gh.exe', '/repo/test/fixtures/gh/gh', '/stubs.mjs/gh', '/stub/gh.js', '/stub/gh.cjs', '/stub/gh.mjs.bak'])(
    'any other override starts as it is, with nothing added: %s',
    (override) => {
      expect(programStart(override, 'gh', NODE)).toEqual({ file: override, args: [], env: {} })
    },
  )

  it('without an override the usual program starts as it is, whatever its name', () => {
    expect(programStart(undefined, 'gh', NODE)).toEqual({ file: 'gh', args: [], env: {} })
    expect(programStart(undefined, '/bundled/claude.mjs', NODE)).toEqual({ file: '/bundled/claude.mjs', args: [], env: {} })
  })
})
