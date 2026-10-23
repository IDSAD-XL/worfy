// test/shell-stub.ts: the shell stand-ins of the tests are links to one stub file, so macOS checks
// no new executable for them, and they still run as the scripts they replace.
import { spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { SHELL_STUB, shellStub } from '../shell-stub'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worfy-shell-stub-'))
})

afterEach(() => {
  removeTestTree(dir)
})

describe.skipIf(process.platform === 'win32')('shellStub', () => {
  it('is a link to the one stub file, which runs the body with the arguments, $0 and the exit code of a script', () => {
    const tool = join(dir, 'tool')
    shellStub(tool, ['echo "me=$0 args=$#:$1|$2"', 'exit 7'])
    expect(lstatSync(tool).isSymbolicLink()).toBe(true)
    expect(readlinkSync(tool)).toBe(SHELL_STUB)
    const run = spawnSync(tool, ['a', 'b c'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } })
    expect(run.stdout).toBe(`me=${tool} args=2:a|b c\n`)
    expect(run.status).toBe(7)
  })

  it('a second call for the same path changes the body; the link stays a link to the stub', () => {
    const tool = join(dir, 'tool')
    shellStub(tool, ['echo first'])
    shellStub(tool, ['echo second'])
    expect(readlinkSync(tool)).toBe(SHELL_STUB)
    expect(spawnSync(tool, [], { encoding: 'utf8' }).stdout).toBe('second\n')
  })

  it('started through further links, absolute and relative, runs the body of the link that has one', () => {
    const tool = join(dir, 'tool')
    shellStub(tool, ['echo "body of tool: $*"'])
    mkdirSync(join(dir, 'tools'))
    symlinkSync(tool, join(dir, 'tools', 'absolute'))
    symlinkSync(join('..', 'tool'), join(dir, 'tools', 'relative'))
    for (const name of ['absolute', 'relative']) {
      const run = spawnSync(join(dir, 'tools', name), [name], { encoding: 'utf8' })
      expect(run.stdout, run.stderr).toBe(`body of tool: ${name}\n`)
      expect(run.status).toBe(0)
    }
  })
})
