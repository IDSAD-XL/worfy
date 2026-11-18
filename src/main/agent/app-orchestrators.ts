// The app's Orchestrators (orchestrator.ts) and when main opens them by itself: the active
// Project's as soon as there is a window to show it, and a Project's when it becomes active. A
// Project removed from the list stops its Orchestrator. src/main/index.ts calls
// startOrchestrators() once; the `orchestrator` IPC handlers only use sharedOrchestrators().
//
// Orchestrators run in the app's registry (app-registry.ts), so `agent.send`, `agent.interrupt`
// and `agent.close` reach them too. Like every Session of the app (the Sessions of `agent.start`
// and of Session Nodes too, ADR-0053 point 4), an Orchestrator belongs to the app rather than to a
// window: its events and views go to every client of the app, and closing a window does not stop
// it. It stops when the app quits, with every other Session.
//
// Each Orchestrator runs on its Project's `defaultVendor` (worfy-multi-vendor ticket 37), read from the
// Project's settings when it starts; a Project that names none runs it on Claude Code.
//
// Auto-continue of the Orchestrators' manual turns (worfy-retry ticket 06, orchestrator-continue.ts)
// follows the app's registry and learns from each view which Session is whose Orchestrator.
//
// Once the first window has loaded, the Sessions a restart of worfy cut off are continued
// (continueAfterRestart, continuity.ts; worfy-continuity ticket 05).
//
// An unattended Orchestrator starts with the Epic of the Autopilot run that holds it (waveEpic,
// Autopilot.runningEpic; worfy-continuity ticket 12): WORFY_EPIC for the Harness's after-compact hook.
import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { LIVE_SESSIONS_FILE } from '../../shared/agent/live-sessions'
import type { SessionSettings } from '../../shared/agent/settings'
import { agentEvent } from '../../shared/ipc/agent'
import { orchestratorChanged, type OrchestratorView } from '../../shared/ipc/orchestrator'
import { parseTranscriptLines } from '../../shared/transcript/parse'
import type { VendorId } from '../../shared/vendors/vendor'
import { toEveryWindow } from '../broadcast'
import { ClaudeHomeRegistry, processState } from '../claude-home/registry'
import { readNewLines } from '../claude-home/tail'
import { appNow } from '../clock'
import { emit } from '../ipc/index'
import { layoutStore } from '../layout/store'
import { projectHolds } from '../projects/holds'
import { readProjectSettings } from '../projects/settings'
import { projectStore } from '../projects/store'
import { appSettingsStore, autoContinueOn } from '../settings/store'
import { claudeHome } from '../storage/paths'
import { restartFile, restartRecordSchema } from '../update/restart'
import { updateDir } from '../update/state'
import { wallTimer } from '../autopilot/limits-wait'
import { vendorDriver } from '../vendors/registry'
import { sharedNodeSessions } from './app-node-sessions'
import { sharedRegistry, tellLiveSessions } from './app-registry'
import { claudeTranscript, Continuity, parentState, processListing, type RunProgram } from './continuity'
import { appLimits } from './limits'
import { refreshAppUsage } from './limits-usage'
import { Orchestrators } from './orchestrator'
import { clockText, OrchestratorContinue } from './orchestrator-continue'
import { readTranscriptFacts, type TranscriptFacts } from './orchestrator-transcript'
import { SessionSettingsStore } from './session-settings'

/** Projects whose Orchestrator may not be opened for now, with how many holds each has. */
const keptClosed = new Map<string, number>()

/** What opening a held Project's Orchestrator answers: an error the caller shows, not a Session. */
export const BEING_REMOVED = 'the project is being removed'

/**
 * The app's Orchestrators with the holds of keepClosed: every opening — main's own (a new window,
 * the active Project, a Linked machine's screen), `orchestrator.open` and `orchestrator.newConversation`
 * of a window — goes through open(), which refuses a held Project before anything starts.
 */
class AppOrchestrators extends Orchestrators {
  override open(projectId: string, options?: { firstSettings?: SessionSettings }): Promise<OrchestratorView> {
    if (keptClosed.has(projectId)) return Promise.reject(new Error(`The Orchestrator was not opened: ${BEING_REMOVED}`))
    return super.open(projectId, options)
  }
}

let shared: Orchestrators | null = null

/**
 * The app's Autopilot module, for the Epic of a run (Orchestrators' waveEpic, worfy-continuity ticket 12). Loaded
 * by a dynamic import when the Orchestrators are made, not by a static one: ipc/autopilot.ts imports this module
 * itself (as src/main/mcp/browser-server.ts reaches it). A run exists only once that module has loaded, so an
 * unattended Session never starts before the lookup can answer.
 */
let autopilotModule: Pick<typeof import('../ipc/autopilot'), 'existingAutopilot'> | null = null

/** The Epic of the Project's run that goes on or is starting; null with no Autopilot made yet, or no run. */
function runningEpic(projectId: string): string | null {
  return autopilotModule?.existingAutopilot()?.runningEpic(projectId) ?? null
}

/** What a Node shows before its Session says anything, when the transcript is not read. */
const NO_FACTS: TranscriptFacts = { model: null, statusBlock: null }

/** The app's Orchestrators, made on first use. */
export function sharedOrchestrators(): Orchestrators {
  if (shared === null) {
    void import('../ipc/autopilot').then(
      (module) => {
        autopilotModule = module
      },
      (error: unknown) => console.warn('[orchestrator] could not load Autopilot: no Session gets the Epic of a run', error),
    )
    const claude = new ClaudeHomeRegistry({ home: claudeHome() })
    /** Each Vendor's reader of what a saved session's transcript tells the Node (TranscriptFacts). */
    const transcripts: Record<VendorId, (projectRoot: string, sessionId: string) => Promise<TranscriptFacts | null>> = {
      claude: async (projectRoot, sessionId) => {
        // A caller of this Machine: a saved Session whose cwd is unknown is still found (RegistryRoot).
        const path = await claude.transcriptPath({ path: projectRoot, local: true }, sessionId)
        return path === null ? null : readTranscriptFacts(path)
      },
      // shortcut: a Codex thread's transcript is not read; its Node shows no model or status block
      // until its first answer after a start, and a thread that is gone is found by the resume itself
      // (orchestrator.ts, NO_CONVERSATION). Redo when the Node must show them at once: read the tail
      // of the thread through the Codex driver (thread/read reads the whole thread).
      codex: () => Promise.resolve(NO_FACTS),
    }
    shared = new AppOrchestrators({
      layout: layoutStore(),
      projectPath: (projectId) => projectStore().get(projectId).path,
      registry: sharedRegistry(),
      // Asked through get(), like the Layout: a Project removed from the list is refused, so a
      // late write does not create its data folder again.
      settings: new SessionSettingsStore((projectId) => projectStore().dataDir(projectStore().get(projectId).id)),
      vendor: (projectId) => readProjectSettings(projectStore().dataDir(projectStore().get(projectId).id)).defaultVendor,
      transcript: (projectRoot, sdkSessionId, vendor) => transcripts[vendor](projectRoot, sdkSessionId),
      capabilities: (vendor) => vendorDriver(vendor).capabilities(),
      harnessHooks: (vendor) => vendorDriver(vendor).harnessHooks,
      waveEpic: runningEpic,
      broadcast: (sessionId, event) => toEveryWindow((target) => emit(target, agentEvent, { sessionId, event })),
      publish: (view) => {
        try {
          sharedOrchestratorContinue().view(view)
        } catch (error) {
          console.warn('[orchestrator] Auto-continue could not take a view of the Orchestrator', error)
        }
        // Whose Session it is, for live-sessions.json (worfy-continuity ticket 03).
        tellLiveSessions((live) => live.orchestrator(view))
        toEveryWindow((target) => emit(target, orchestratorChanged, view))
      },
    })
  }
  return shared
}

let continuer: OrchestratorContinue | null = null

/**
 * The e2e tests' seam (worfy-retry ticket 07): with WORFY_CONTINUE_PAUSE_MS a whole number of ms above
 * zero, a manual wait sends its continuation that long after it began at the latest — seconds, not the
 * minutes of the plan; the wait still shows the time of the plan. Nothing without it.
 */
export function continuePauseSeam(env: NodeJS.ProcessEnv): { schedule?: (at: number, fire: () => void) => () => void } {
  const given = env.WORFY_CONTINUE_PAUSE_MS
  if (given === undefined || !/^[1-9]\d*$/u.test(given)) return {}
  const pause = Number(given)
  const timer = wallTimer()
  return { schedule: (at, fire) => timer(Math.min(at, Date.now() + pause), fire) }
}

/**
 * Auto-continue of the Orchestrators' manual turns, made on first use: the Project's switch of
 * app-settings.json, the Limits of limits.json, the pauses by the wall clock. It stops when the app
 * quits; the registry closes every Session then too, which ends any wait.
 */
export function sharedOrchestratorContinue(): OrchestratorContinue {
  if (continuer === null) {
    const made = new OrchestratorContinue({
      observe: (sink) => sharedRegistry().observe(sink),
      session: (sessionId) => sharedRegistry().get(sessionId),
      enabled: (projectId) => autoContinueOn(projectId),
      observeSettings: (listener) => {
        const store = appSettingsStore()
        store.on('changed', listener)
        return () => void store.off('changed', listener)
      },
      limits: () => appLimits().snapshot(),
      // Codex: the windows read anew before a continuation after the Limits, as a run does (ipc/autopilot.ts).
      windows: (vendor) => appLimits().windowsOf(vendor),
      usage: { refresh: (olderThanMs, vendor) => refreshAppUsage(olderThanMs, vendor) },
      ...continuePauseSeam(process.env),
    })
    app.on('will-quit', () => made.stop())
    continuer = made
  }
  return continuer
}

/**
 * The Project's Orchestrator is not opened — by main itself or for a window — until the returned
 * function is called (AppOrchestrators). The removal of the Demo project holds it while it closes
 * the demo's Sessions and deletes the folder (worfy-onboarding ticket 10).
 */
export function keepClosed(projectId: string): () => void {
  keptClosed.set(projectId, (keptClosed.get(projectId) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (keptClosed.get(projectId) ?? 1) - 1
    if (left > 0) keptClosed.set(projectId, left)
    else keptClosed.delete(projectId)
  }
}

function openActive(): void {
  try {
    const active = projectStore().active()
    if (active) {
      sharedOrchestrators()
        .open(active.id)
        .catch((error: unknown) => console.error(`[orchestrator] could not open the Orchestrator of ${active.id}`, error))
    }
  } catch (error) {
    console.error('[orchestrator] could not open the Orchestrator of the active Project', error)
  }
}

/**
 * Opens the Orchestrator of every Project a screen of a Linked machine shows (worfy-link ticket
 * 09, projects/holds.ts), as for the active Project. Opening one that is open does nothing.
 */
function openHeld(): void {
  for (const projectId of projectHolds().projectIds()) {
    try {
      sharedOrchestrators()
        .open(projectId)
        .catch((error: unknown) => console.error(`[orchestrator] could not open the Orchestrator of ${projectId}`, error))
    } catch (error) {
      console.error(`[orchestrator] could not open the Orchestrator of the held Project ${projectId}`, error)
    }
  }
}

/** Reads a file as text; null when it is not there. */
async function textOf(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

/** Every line of a file, read in chunks as the Session view reads a transcript; a torn last line is left out. */
async function linesOf(path: string): Promise<string[]> {
  const lines: string[] = []
  let chunk = await readNewLines(path)
  lines.push(...chunk.lines)
  while (chunk.more) {
    chunk = await readNewLines(path, chunk.cursor)
    lines.push(...chunk.lines)
  }
  return lines
}

const run: RunProgram = (file, args, options) =>
  new Promise((done, fail) => execFile(file, [...args], { ...options, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => (error ? fail(error) : done(stdout))))

/** How often the wait for a previous process of a Session asks whether it is gone. */
const EXIT_POLL_MS = 250

/**
 * The continuation of the Sessions a restart of worfy cut off (continuity.ts, worfy-continuity ticket 05), over the
 * app's parts: every Project's `live-sessions.json`, the Claude home (read only, ADR-0005) for a Claude Code
 * Session's transcript and its previous process, a Codex thread through its driver's history, the Orchestrators,
 * the Session Nodes and the record of live Sessions for the count of continuations.
 */
export async function continueAfterRestart(): Promise<void> {
  const claude = new ClaudeHomeRegistry({ home: claudeHome() })
  const projects = projectStore()
  const outcomes = await new Continuity({
    projects: () => projects.list().map((project) => ({ id: project.id, root: project.path, dataDir: projects.dataDir(project.id) })),
    readFile: textOf,
    liveFile: (project) => join(project.dataDir, LIVE_SESSIONS_FILE),
    transcript: async (project, record) => {
      const id = record.vendorSessionId
      if (id === null) return null
      if (record.vendor !== 'claude') return { entries: await vendorDriver(record.vendor).history.read(id, project.root), subagents: [] }
      return claudeTranscript(() => claude.transcriptPath({ path: project.root, local: true }, id), {
        lines: linesOf,
        names: async (dir) => (await readdir(dir).catch(() => [])).map(String),
        parse: (lines) => parseTranscriptLines(lines),
      })
    },
    previous: async (project, record) => {
      // Codex: worfy's own app-server per Session, no record of it under the Claude home (spec, risk 10).
      if (record.vendor !== 'claude' || record.vendorSessionId === null) return null
      const found = (await claude.live({ path: project.root, local: true })).find((live) => live.sessionId === record.vendorSessionId)
      if (found === undefined) return null
      const state = parentState(process.platform, await processListing(process.platform, run), found.pid, process.pid)
      if (state === 'gone') return null
      // Another program's Claude Code (a terminal, Claude desktop) is never the Session worfy left behind.
      const ours = found.entrypoint === undefined || found.entrypoint === 'sdk-ts'
      return { pid: found.pid, orphan: ours && state === 'orphan' }
    },
    exited: async (previous, withinMs) => {
      const until = Date.now() + withinMs
      for (;;) {
        if ((await processState(previous.pid, previous.procStart)) === 'gone') return true
        if (Date.now() >= until) return false
        await new Promise((done) => setTimeout(done, EXIT_POLL_MS))
      }
    },
    kill: (previous) => void process.kill(previous.pid, 'SIGKILL'),
    orchestrator: (projectId) => sharedOrchestrators().openSession(projectId),
    node: (projectId, nodeId, sessionId) => sharedNodeSessions().started(projectId, nodeId, sessionId),
    keptSession: (projectId, nodeId) => sharedNodeSessions().keptSessionOf(projectId, nodeId),
    interrupted: (projectId, nodeId, mark) => sharedNodeSessions().interrupted(projectId, nodeId, mark),
    noteContinued: (nodeId, at) => tellLiveSessions((live) => live.noteContinued(nodeId, at)),
    updatedAt: async () => {
      const text = await textOf(restartFile(updateDir()))
      const parsed = text === null ? null : restartRecordSchema.safeParse(JSON.parse(text))
      return parsed?.success === true ? Date.parse(parsed.data.at) : null
    },
    now: appNow,
    clock: clockText,
  }).run()
  for (const outcome of outcomes) console.warn(`[continuity] ${outcome.projectId} ${outcome.nodeId} (${outcome.kind}): ${outcome.outcome}${outcome.reason === null ? '' : `: ${outcome.reason}`}`)
}

let started = false
let continuing = false

/** Opens the active Project; on the first window, once its page has loaded, continues the Sessions a restart cut off. */
function onWindow(_event?: unknown, window?: BrowserWindow): void {
  openActive()
  if (continuing || window === undefined) return
  continuing = true
  window.webContents.once('did-finish-load', () => {
    continueAfterRestart().catch((error: unknown) => console.error('[continuity] the Sessions cut off by the restart were not continued', error))
  })
}

/**
 * Subscribes main's own opening of Orchestrators; a second call does nothing. Subscribing reads
 * nothing: the Project list is read on the first window, not when this runs. Once the first window
 * has loaded, the Sessions a restart cut off are continued (continueAfterRestart): its page then
 * hears their events and notice lines.
 */
export function startOrchestrators(): void {
  if (started) return
  started = true
  app.on('browser-window-created', onWindow)
  projectHolds().onChange(openHeld)
  projectStore().onChange(({ activeId, previousActiveId }) => {
    if (activeId !== previousActiveId) openActive()
    shared?.retain(new Set(projectStore().list().map((project) => project.id)))
  })
}
