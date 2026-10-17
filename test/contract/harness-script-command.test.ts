// How worfy picks the program that starts a Harness script (src/main/workflow/profile.ts,
// nodeOnPath and harnessScriptCommand; worfy-windows ticket 05): the node of the PATH it hands the
// script, found in PATH order among absolute folders only, a real file and, on macOS and Linux,
// executable; a Node script runs as `node <script>`, an older Harness's shell script by itself
// outside Windows. Then the reader's answer when the start fails after those checks
// (src/main/workflow/reader.ts, runEpicStatus). Fake PATHs of temporary folders throughout: the
// fake nodes are never started.
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, relative } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { harnessScriptCommand, HarnessScriptStartError, nodeOnPath } from '../../src/main/workflow/profile'
import { epicStatusRunner } from '../../src/main/workflow/reader'
import { catScript, NODE, NODE_DIR, scriptsEnv } from '../harness-node'
import { removeTestTree } from '../remove'

const WINDOWS = process.platform === 'win32'
const NODE_NAME = WINDOWS ? 'node.exe' : 'node'
/** A root user reads and runs any file: the permission cases below mean nothing then. */
const ROOT = typeof process.getuid === 'function' && process.getuid() === 0

let scratch: string

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-script-command-')))
})

afterEach(() => {
  removeTestTree(scratch)
})

/** A folder `name` under the test's folder with a fake node in it; `mode` for that file on POSIX. */
function nodeDir(name: string, mode = 0o755): string {
  const dir = join(scratch, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, NODE_NAME), '')
  if (!WINDOWS) chmodSync(join(dir, NODE_NAME), mode)
  return dir
}

const pathOf = (...dirs: string[]): { PATH: string } => ({ PATH: dirs.join(delimiter) })

/** A script under the test's folder with `text`. */
function script(name: string, text: string | Buffer): string {
  const path = join(scratch, 'bin', name)
  mkdirSync(join(scratch, 'bin'), { recursive: true })
  writeFileSync(path, text)
  return path
}

describe('nodeOnPath', () => {
  it('takes the first node in PATH order', async () => {
    const first = nodeDir('first')
    const second = nodeDir('second')
    expect(await nodeOnPath(pathOf(first, second))).toBe(join(first, NODE_NAME))
    expect(await nodeOnPath(pathOf(second, first))).toBe(join(second, NODE_NAME))
  })

  it('skips a relative PATH entry, even one that leads to a node from worfy\'s working folder', async () => {
    const near = nodeDir('near')
    const far = nodeDir('far')
    const rel = relative(process.cwd(), near)
    // On another drive than the working folder there is no relative path to it.
    expect(isAbsolute(rel)).toBe(false)
    expect(await nodeOnPath(pathOf(rel, far))).toBe(join(far, NODE_NAME))
    expect(await nodeOnPath(pathOf(rel))).toBeNull()
  })

  // `\tools` is the root of the current drive: checked on worfy's drive, started on the drive of the
  // script's working folder.
  it.runIf(WINDOWS)('on Windows skips an entry rooted at the current drive (\\tools), as findOnPath does', async () => {
    const rooted = nodeDir('rooted')
    const good = nodeDir('good')
    // The same folder without its drive: on the drive of the working folder it is that folder.
    expect(process.cwd().slice(0, 2).toLowerCase()).toBe(rooted.slice(0, 2).toLowerCase())
    const driveless = rooted.slice(2)
    expect(driveless.startsWith('\\')).toBe(true)
    expect(await nodeOnPath(pathOf(driveless, good))).toBe(join(good, NODE_NAME))
    expect(await nodeOnPath(pathOf(`/${driveless.slice(1).replaceAll('\\', '/')}`))).toBeNull()
  })

  it('skips a folder named node', async () => {
    const odd = join(scratch, 'odd')
    mkdirSync(join(odd, NODE_NAME), { recursive: true })
    const good = nodeDir('good')
    expect(await nodeOnPath(pathOf(odd, good))).toBe(join(good, NODE_NAME))
  })

  // Windows has no execute bit: there a node.exe that is a file is taken.
  it.skipIf(WINDOWS || ROOT)('on macOS and Linux skips a node file that is not executable', async () => {
    const plain = nodeDir('plain', 0o644)
    const good = nodeDir('good')
    expect(await nodeOnPath(pathOf(plain, good))).toBe(join(good, NODE_NAME))
    expect(await nodeOnPath(pathOf(plain))).toBeNull()
  })
})

describe('harnessScriptCommand', () => {
  const env = (): Record<string, string> => scriptsEnv([NODE_DIR])

  it('a Node script runs as `node <script>` with the arguments after it', async () => {
    const path = script('epic-status', catScript(join(scratch, 'x')))
    expect(await harnessScriptCommand(path, ['--json', '--ref', 'demo/02'], env())).toEqual({ file: NODE, args: [path, '--json', '--ref', 'demo/02'] })
  })

  it('a script with no #! line is a Node script: started by node, never by itself', async () => {
    const path = script('profile', 'process.stdout.write("x")\n')
    expect(await harnessScriptCommand(path, ['--json'], env())).toEqual({ file: NODE, args: [path, '--json'] })
  })

  it('a folder at the script\'s path is no script: ENOENT, nothing started', async () => {
    const path = join(scratch, 'bin', 'epic-status')
    mkdirSync(path, { recursive: true })
    const started = harnessScriptCommand(path, ['--json'], env())
    await expect(started).rejects.toBeInstanceOf(HarnessScriptStartError)
    await expect(started).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('a byte order mark before `#!/usr/bin/env node` is still a Node script', async () => {
    const path = script('ticket', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('#!/usr/bin/env node\nprocess.exitCode = 0\n')]))
    expect(await harnessScriptCommand(path, ['root'], env())).toEqual({ file: NODE, args: [path, 'root'] })
  })

  it("a byte order mark before `#!/bin/bash` is still an older Harness's shell script", async () => {
    const path = script('epic-status', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('#!/bin/bash\necho "{}"\n')]))
    const started = harnessScriptCommand(path, ['--json'], env())
    if (WINDOWS) await expect(started).rejects.toMatchObject({ code: 'NOT_NODE' })
    else expect(await started).toEqual({ file: path, args: ['--json'] })
  })

  it.skipIf(WINDOWS)("on macOS and Linux an older Harness's shell script is started by itself with the arguments", async () => {
    const path = script('epic-status', '#!/bin/sh\necho "{}"\n')
    expect(await harnessScriptCommand(path, ['--json', '--ref', 'demo/02'], env())).toEqual({ file: path, args: ['--json', '--ref', 'demo/02'] })
  })

  // Windows: no file mode makes a file unreadable to its owner; there node is started and says why.
  it.skipIf(WINDOWS || ROOT)('on macOS and Linux a script worfy cannot read is started by itself, as before scripts were Node', async () => {
    const path = script('profile', '#!/usr/bin/env node\n')
    chmodSync(path, 0o311)
    expect(await harnessScriptCommand(path, ['--json'], env())).toEqual({ file: path, args: ['--json'] })
  })
})

describe('runEpicStatus when the start fails after the checks', () => {
  /** A Claude home of the old layout whose bin/epic-status is `text`. */
  function home(text: string, mode = 0o755): string {
    const claudeHome = join(scratch, 'claude-home')
    mkdirSync(join(claudeHome, 'bin'), { recursive: true })
    writeFileSync(join(claudeHome, 'bin', 'epic-status'), text)
    if (!WINDOWS) chmodSync(join(claudeHome, 'bin', 'epic-status'), mode)
    return claudeHome
  }

  it('a working folder that is gone: not-found, "could not be started", not a failed script', async () => {
    const claudeHome = home(catScript(join(scratch, 'none')))
    const run = epicStatusRunner(claudeHome, () => Promise.resolve(scriptsEnv([NODE_DIR])))(join(scratch, 'no-such-folder'), null)
    await expect(run).rejects.toMatchObject({ workflowError: { code: 'not-found', message: expect.stringMatching(/^epic-status could not be started: /) } })
  })

  it.skipIf(WINDOWS || ROOT)("an older Harness's shell script without the execute bit: not-found, not a failed script", async () => {
    const claudeHome = home('#!/bin/sh\necho "{}"\n', 0o644)
    const run = epicStatusRunner(claudeHome, () => Promise.resolve(scriptsEnv([NODE_DIR])))(scratch, null)
    await expect(run).rejects.toMatchObject({ workflowError: { code: 'not-found', message: expect.stringMatching(/^epic-status could not be started: /) } })
  })
})
