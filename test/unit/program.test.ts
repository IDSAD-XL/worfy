// What worfy starts for a program an override variable may name in its place (src/main/program.ts):
// a `.mjs` override is a Node script and runs under the Node of scriptRunner — worfy's own executable
// when it is the stock Electron, `node` of the PATH in the packaged app, whose RunAsNode fuse is off
// (worfy-auto-approve ticket 12); any other override, and the usual program when nothing overrides it,
// start as they are. The same on every system. In a pseudo-terminal on Windows a `.mjs` override runs
// under node.exe of the terminal's Path instead.
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { programStart, programStartInPty, scriptRunner } from '../../src/main/program'

/** The stock Electron of node_modules, as `pnpm dev` and the e2e runs of out/ start it. */
const NODE = '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
const ELECTRON_EXE = 'C:\\repo\\node_modules\\electron\\dist\\electron.exe'
/** The packaged worfy: its RunAsNode fuse is off (electron-builder.yml). */
const PACKAGED = '/Applications/worfy.app/Contents/MacOS/worfy'
const PACKAGED_EXE = 'C:\\Users\\someone\\AppData\\Local\\Programs\\worfy\\worfy.exe'

describe('scriptRunner', () => {
  it('is the stock Electron itself in run-as-Node mode, whatever the case of its name', () => {
    expect(scriptRunner(NODE, 'darwin')).toEqual({ file: NODE, env: { ELECTRON_RUN_AS_NODE: '1' } })
    expect(scriptRunner('/repo/node_modules/electron/dist/electron', 'linux')).toEqual({ file: '/repo/node_modules/electron/dist/electron', env: { ELECTRON_RUN_AS_NODE: '1' } })
    expect(scriptRunner(ELECTRON_EXE, 'win32')).toEqual({ file: ELECTRON_EXE, env: { ELECTRON_RUN_AS_NODE: '1' } })
    expect(scriptRunner('C:\\repo\\Electron.EXE', 'win32')).toEqual({ file: 'C:\\repo\\Electron.EXE', env: { ELECTRON_RUN_AS_NODE: '1' } })
  })

  it('is node of the PATH, with no variable added, for the packaged worfy and worfy.exe', () => {
    expect(scriptRunner(PACKAGED, 'darwin')).toEqual({ file: 'node', env: {} })
    expect(scriptRunner(PACKAGED_EXE, 'win32')).toEqual({ file: 'node', env: {} })
  })

  it('reads the file name by the rules of the system: electron.exe off Windows, or a folder named electron, is not the stock Electron', () => {
    expect(scriptRunner('/opt/electron.exe', 'darwin')).toEqual({ file: 'node', env: {} })
    expect(scriptRunner('C:\\electron\\worfy.exe', 'win32')).toEqual({ file: 'node', env: {} })
    expect(scriptRunner('/repo/electron/worfy', 'linux')).toEqual({ file: 'node', env: {} })
    expect(scriptRunner('C:\\repo\\electron', 'win32')).toEqual({ file: 'node', env: {} })
  })

  it('by default reads the file this process runs from: the stock Electron under `pnpm test`', () => {
    expect(scriptRunner()).toEqual({ file: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } })
  })
})

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

  it.each([
    [PACKAGED, 'darwin'],
    [PACKAGED_EXE, 'win32'],
  ] as const)('in the packaged app (%s) a .mjs override runs under node of the PATH, without ELECTRON_RUN_AS_NODE', (execPath, platform) => {
    expect(programStart('/repo/test/fixtures/gh/gh-stub.mjs', 'gh', execPath, platform)).toEqual({ file: 'node', args: ['/repo/test/fixtures/gh/gh-stub.mjs'], env: {} })
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

describe('programStartInPty', () => {
  const NODE_EXE = 'C:\\Program Files\\nodejs\\node.exe'
  const WIN_ENV = { Path: 'C:\\Windows\\System32;C:\\Program Files\\nodejs' }
  const onlyNode = (path: string): boolean => path === NODE_EXE

  it('off Windows is programStart: a .mjs override runs under worfy\'s own Node', () => {
    expect(programStartInPty('/repo/gh-stub.mjs', 'gh', { platform: 'darwin', execPath: NODE })).toEqual({ file: NODE, args: ['/repo/gh-stub.mjs'], env: { ELECTRON_RUN_AS_NODE: '1' } })
    expect(programStartInPty(join('test', 'gh-stub.mjs'), 'gh', { platform: 'linux', execPath: NODE }).args).toEqual([resolve('test', 'gh-stub.mjs')])
  })

  it('off Windows in the packaged app a .mjs override runs under node of the PATH', () => {
    expect(programStartInPty('/repo/gh-stub.mjs', 'gh', { platform: 'darwin', execPath: PACKAGED })).toEqual({ file: 'node', args: ['/repo/gh-stub.mjs'], env: {} })
  })

  it('on Windows a .mjs override runs under node.exe of the Path of the terminal, with no variable added', () => {
    const script = 'C:\\repo\\test\\fixtures\\gh\\gh-stub.mjs'
    expect(programStartInPty(script, 'gh', { platform: 'win32', env: WIN_ENV, exists: onlyNode, execPath: NODE })).toEqual({ file: NODE_EXE, args: [script], env: {} })
  })

  it('on Windows a relative .mjs override is resolved against worfy\'s own folder, not the terminal\'s', () => {
    const start = programStartInPty(join('test', 'fixtures', 'gh', 'gh-stub.mjs'), 'gh', { platform: 'win32', env: WIN_ENV, exists: onlyNode })
    expect(start.args).toEqual([resolve('test', 'fixtures', 'gh', 'gh-stub.mjs')])
  })

  it('on Windows without node.exe in the Path a .mjs override starts nothing and says why', () => {
    expect(() => programStartInPty('C:\\stub\\gh.mjs', 'gh', { platform: 'win32', env: WIN_ENV, exists: () => false })).toThrow(
      'node.exe was not found in the Path: the .mjs stand-in C:\\stub\\gh.mjs needs it on Windows',
    )
  })

  it('on Windows any other override, and no override, come back as they are', () => {
    for (const override of ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe', 'C:\\stub\\gh.js']) {
      expect(programStartInPty(override, 'gh', { platform: 'win32', env: WIN_ENV, exists: () => true })).toEqual({ file: override, args: [], env: {} })
    }
    expect(programStartInPty(undefined, 'gh', { platform: 'win32', env: WIN_ENV, exists: () => true })).toEqual({ file: 'gh', args: [], env: {} })
  })
})
