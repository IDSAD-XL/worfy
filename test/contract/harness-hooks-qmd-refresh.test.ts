// The Stop hook that refreshes the qmd index (harness/hooks/qmd-refresh.mjs, worfy-windows 115). The
// refresh itself is the zsh script harness/bin/qmd-refresh; Windows has no zsh, and a hook that ran
// the script directly ended every turn there with exit 127 and "Stop hook error occurred". The hook
// is a node script: without zsh it exits 0 and prints nothing, with zsh it runs the script with
// --quiet. Here zsh is a stub on PATH that writes down its arguments.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'

const HARNESS = join(__dirname, '..', '..', 'harness')
const HOOK = join(HARNESS, 'hooks', 'qmd-refresh.mjs')
const WINDOWS = process.platform === 'win32'

let root: string
let stubDir: string
let calls: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'worfy-qmd-refresh-hook-'))
  stubDir = join(root, 'stub-bin')
  calls = join(root, 'zsh-calls')
  mkdirSync(stubDir)
})

afterEach(() => removeTestTree(root))

/** Puts a zsh stub on stubDir: it writes its arguments, one per line, into `calls`. */
function stubZsh(): void {
  const zsh = join(stubDir, 'zsh')
  writeFileSync(zsh, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done >> '${calls}'\n`)
  chmodSync(zsh, 0o755)
}

/** Runs the hook the way Claude Code runs a Stop hook: the hook JSON on stdin, PATH = stubDir only. */
function runHook() {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key.toUpperCase() !== 'PATH') env[key] = value
  }
  env.PATH = stubDir
  return spawnSync(scriptNode(), [HOOK], {
    input: JSON.stringify({ hook_event_name: 'Stop' }),
    encoding: 'utf8',
    env,
    windowsHide: true,
  })
}

describe('harness/hooks/qmd-refresh.mjs', () => {
  it('without zsh on PATH exits 0 and prints nothing', () => {
    const run = runHook()
    expect(run.error).toBeUndefined()
    expect({ status: run.status, stdout: run.stdout, stderr: run.stderr }).toEqual({ status: 0, stdout: '', stderr: '' })
  })

  it.runIf(WINDOWS)('on Windows exits 0, prints nothing and starts no zsh, even with zsh on PATH', () => {
    stubZsh()
    const run = runHook()
    expect({ status: run.status, stdout: run.stdout, stderr: run.stderr }).toEqual({ status: 0, stdout: '', stderr: '' })
    expect(existsSync(calls)).toBe(false)
  })

  it.skipIf(WINDOWS)('with zsh on PATH runs bin/qmd-refresh --quiet through it', () => {
    stubZsh()
    const run = runHook()
    expect({ status: run.status, stderr: run.stderr }).toEqual({ status: 0, stderr: '' })
    expect(readFileSync(calls, 'utf8').split('\n').filter(Boolean)).toEqual([join(HARNESS, 'bin', 'qmd-refresh'), '--quiet'])
  })
})
