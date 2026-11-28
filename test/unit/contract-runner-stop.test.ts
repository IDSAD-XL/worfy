// The stop of the contract set (src/main/harness/contract/runner.ts, worfy-harness-guarantees ticket 09, review round
// 1): when worfy quits, the `claude -p` under way ends with every process of its tree, its temporary folder goes at
// once, and no case starts after it. The binary is a shell script of the test that starts a child of its own and
// waits: no Claude Code, no model.
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runContractCase, runContractSet, STOPPED, type ContractCase, type ContractSetOptions } from '../../src/main/harness/contract/runner'
import { removeTestTree } from '../remove'

const CASE = (id: string): ContractCase => ({ id, title: `case ${id}`, prompt: 'hello', check: () => null })

let marks: string
let scratch: string
let options: ContractSetOptions

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

beforeEach(() => {
  marks = mkdtempSync(join(tmpdir(), 'contract-stop-marks-'))
  scratch = mkdtempSync(join(tmpdir(), 'contract-stop-scratch-'))
  const binary = join(marks, 'claude')
  // Writes its pid, starts a child that outlives a kill of the script alone, and waits; each start is a line of `runs`.
  writeFileSync(binary, ['#!/bin/sh', `echo started >> '${join(marks, 'runs')}'`, `echo $$ > '${join(marks, 'script.pid')}'`, 'sleep 60 &', `echo $! > '${join(marks, 'child.pid')}'`, 'wait', ''].join('\n'))
  chmodSync(binary, 0o755)
  options = { binary, pluginDir: marks, runLimitMs: 60_000, scratch }
})

afterEach(() => {
  for (const file of ['script.pid', 'child.pid']) {
    const path = join(marks, file)
    if (!existsSync(path)) continue
    try {
      process.kill(Number(readFileSync(path, 'utf8')), 'SIGKILL')
    } catch {
      // Already gone: what the test wants.
    }
  }
  removeTestTree(marks)
  removeTestTree(scratch)
})

describe.skipIf(process.platform === 'win32')('the contract set stops when worfy quits', () => {
  it('a stop ends the running case with its whole tree and removes its temporary folder at once; the case is not run', async () => {
    const stop = new AbortController()
    const outcome = runContractCase(CASE('one'), { ...options, signal: stop.signal })
    await expect.poll(() => existsSync(join(marks, 'child.pid')) && readFileSync(join(marks, 'child.pid'), 'utf8').trim() !== '', { timeout: 10_000 }).toBe(true)
    const pids = ['script.pid', 'child.pid'].map((file) => Number(readFileSync(join(marks, file), 'utf8')))
    expect(readdirSync(scratch)).toHaveLength(1)
    stop.abort()
    // Synchronous, before any await: a quit of worfy does not wait for the `finally` of the case.
    expect(readdirSync(scratch)).toEqual([])
    await expect(outcome).resolves.toEqual({ id: 'one', title: 'case one', status: 'not-run', reason: STOPPED })
    for (const pid of pids) await expect.poll(() => alive(pid)).toBe(false)
  })

  it('a stop during the first case starts no case after it, and a set already stopped starts nothing', async () => {
    const stop = new AbortController()
    const set = runContractSet([CASE('one'), CASE('two')], { ...options, signal: stop.signal })
    await expect.poll(() => existsSync(join(marks, 'child.pid')) && readFileSync(join(marks, 'child.pid'), 'utf8').trim() !== '', { timeout: 10_000 }).toBe(true)
    stop.abort()
    expect((await set).map((each) => [each.id, each.status, each.status === 'passed' ? null : each.reason])).toEqual([
      ['one', 'not-run', STOPPED],
      ['two', 'not-run', STOPPED],
    ])
    expect(readFileSync(join(marks, 'runs'), 'utf8').trim().split('\n')).toHaveLength(1)
    expect(await runContractSet([CASE('three')], { ...options, signal: stop.signal })).toEqual([{ id: 'three', title: 'case three', status: 'not-run', reason: STOPPED }])
    expect(readFileSync(join(marks, 'runs'), 'utf8').trim().split('\n')).toHaveLength(1)
    expect(readdirSync(scratch)).toEqual([])
  })
})
