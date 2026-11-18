// "Restart when idle" and an Autopilot Run in a Wait (worfy-continuity ticket 08): the Run that waits for the Limits
// holds no restart, worfy quits through the quit's coordinator with the cause `update`, restart.json says so, and the
// start after continues the Run with `run-continued` after `update`. The Run is faultRun()'s
// (autopilot-faults-setup.ts) on the test's clock; the Update side is restart.ts over a temporary folder with a
// stand-in spawn, as test/contract/update-restart.test.ts has it: no helper runs and no app quits. The coordinator
// runs the steps of quitSteps without the registry's depart, as autopilot-faults-restart.test.ts does: the same
// registry serves the next start, whose Sessions must send.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { quitForUpdate, sessionsOf } from '../../src/main/ipc/update'
import { QuitGrace, quitSteps, setAppQuitGrace } from '../../src/main/quit-grace'
import { autopilotRuns, IdleWatch } from '../../src/main/update/idle'
import { helperScript, restartFile, Restarts, type SpawnDetached } from '../../src/main/update/restart'
import { changeUpdateState } from '../../src/main/update/state'
import type { JournalEvent } from '../../src/shared/autopilot/journal'
import { findScriptNode } from '../script-node'
import { assertTemporaryStableCopy } from '../update-stub'
import { faultRun, PROJECT, until, type FaultScript } from './autopilot-faults-setup'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/nowhere', on: () => undefined, quit: () => undefined },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showMessageBox: () => Promise.reject(new Error('no dialog in this test')) },
  powerSaveBlocker: { start: () => 0, stop: () => undefined, isStarted: () => false },
  shell: { openPath: () => Promise.resolve('') },
}))

const init = { type: 'system', subtype: 'init', cwd: '{{cwd}}', session_id: '{{session}}', tools: ['Bash'], mcp_servers: [], model: 'claude-opus-5-5', permissionMode: 'bypassPermissions', slash_commands: ['epic-wave'], apiKeySource: 'none', claude_code_version: '2.1.289', uuid: '00000000-0000-4000-8000-000000000d01' }
const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const interrupted = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, parent_tool_use_id: null, session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000000d02' }
const cut = { type: 'result', subtype: 'error_during_execution', is_error: true, errors: [], total_cost_usd: 0, duration_ms: 1, duration_api_ms: 1, num_turns: 1, usage, modelUsage: {}, permission_denials: [], session_id: '{{session}}', uuid: '00000000-0000-4000-8000-000000000d03' }

/** Every turn after the restart runs until it is interrupted. */
const UNTIL_INTERRUPT: FaultScript = [{ fake: 'wait_message' }, init, { fake: 'wait_interrupt' }, interrupted, cut]

const BUILT_SHA = 'b'.repeat(40)
const RUNNING_SHA = 'a'.repeat(40)

/** The Update side of the restart in `root`: the clone's helper and a ready build, as ticket 03 leaves them. */
function readyUpdate(root: string): { dir: string; stateFile: string; target: string } {
  const dir = join(root, 'update')
  const target = join(root, 'Applications', process.platform === 'win32' ? 'worfy-stable' : 'worfy-stable.app')
  assertTemporaryStableCopy(target)
  const appPath = join(dir, 'repo', 'dist', 'built.app')
  const stateFile = join(dir, 'state.json')
  mkdirSync(dirname(helperScript(dir)), { recursive: true })
  writeFileSync(helperScript(dir), '// stands in for scripts/install-stable.mjs; never run by this test\n')
  mkdirSync(appPath, { recursive: true })
  changeUpdateState((state) => ({ ...state, build: { phase: 'ready', sha: BUILT_SHA, version: '0.6.0+bbbbbbb', appPath, log: 'build.log' } }), stateFile)
  return { dir, stateFile, target }
}

describe('Update during work (worfy-continuity ticket 08)', () => {
  it('a Run in the Wait for the Limits does not hold "Restart when idle": worfy restarts, restart.json says update, and the Run goes on after update', async () => {
    // Wave 1 goes through; the turn of Wave 2 is refused by the Limits, its Ticket 03 claimed.
    const h = faultRun({ scripts: ['autopilot-waves', 'autopilot-limits', UNTIL_INTERRUPT] })
    h.registry.observe((_sessionId, event) => {
      if (event.type === 'prompt' && /epic-wave .*\b01, 02\b/u.test(event.text)) h.setMarks('claimed')
    })
    expect(await h.start()).toEqual({ refusal: null })
    await until(() => h.state().status === 'waiting' || h.state().status === 'stopped', 'the wait for the Limits')
    expect(h.state()).toMatchObject({ status: 'waiting', waitingFor: 'limits', wave: 2 })

    const update = readyUpdate(h.scratch)
    const watch = new IdleWatch({
      sources: { sessions: () => sessionsOf(h.registry), autopilot: () => autopilotRuns(h.autopilot, [PROJECT]) },
      observe: (listener) => h.registry.observe(listener),
    })
    const stopWatch = watch.start()
    const steps = quitSteps(() => ({ registry: { depart: () => undefined, haltAll: (ms) => h.registry.haltAll(ms) }, autopilot: h.autopilot, haltTurnMs: 100 }))
    const grace = new QuitGrace({ ...steps, calls: { open: () => [], observe: () => () => undefined }, show: () => undefined, quit: () => undefined })
    // The app's coordinator, as src/main/index.ts sets it.
    setAppQuitGrace(grace)
    const spawned: string[][] = []
    const spawn: SpawnDetached = (_file, args) => {
      spawned.push([...args])
      return { pid: 777, on: () => undefined, unref: () => undefined }
    }
    const restarts = new Restarts({
      ...update,
      stateFile: () => update.stateFile,
      target: () => update.target,
      pid: 4242,
      env: () => Promise.resolve({ PATH: dirname(findScriptNode(process.env)), ...(process.platform === 'win32' ? { PATHEXT: '.COM;.EXE;.BAT;.CMD' } : {}) }),
      running: () => ({ commit: RUNNING_SHA, version: '0.5.0+aaaaaaa' }),
      idle: watch,
      client: { compare: () => Promise.resolve({ ok: true, value: { status: 'ahead', files: [], commits: [] } }) },
      quit: () => quitForUpdate(),
      spawn,
    })
    try {
      expect(watch.idle).toBe(true)
      expect(await restarts.restart('idle')).toEqual({ outcome: 'quitting' })
      // The quit under way: a second leave answers its end.
      await grace.leave('quit')
    } finally {
      stopWatch()
    }
    expect(spawned).toHaveLength(1)
    expect(JSON.parse(readFileSync(restartFile(update.dir), 'utf8'))).toMatchObject({ action: 'install', sha: BUILT_SHA, cause: 'update' })
    const suspended = h.journal(1).at(-1) as Extract<JournalEvent, { kind: 'run-suspended' }>
    expect(suspended).toMatchObject({ kind: 'run-suspended', cause: 'update', wave: 2, wait: { kind: 'limits' } })

    const autopilot = h.restartApp()
    h.setMarks('none')
    await autopilot.continueCutOff(PROJECT)
    await until(() => h.kinds(1).includes('run-continued'), 'the Run continued after the start')
    expect(h.journal(1).find((event) => event.kind === 'run-continued')).toMatchObject({ kind: 'run-continued', after: 'update' })
    expect(autopilot.state(PROJECT)).toMatchObject({ status: 'waiting', waitingFor: 'limits' })
    await autopilot.forceStop(PROJECT)
  })
})
