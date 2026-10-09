import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import {
  projectsAdd,
  projectsChanged,
  projectsConnectActivity,
  projectsConnectCheck,
  projectsConnectDraft,
  projectsConnectInspect,
  projectsConnectStop,
  projectsConnectWrite,
  projectsHold,
  projectsList,
  projectsPickFolder,
  projectsRemove,
  projectsSelect,
  projectsSettingsChanged,
  projectsSettingsDefaults,
  projectsSettingsGet,
  projectsSettingsSet,
} from '../../shared/ipc/projects'
import { defaultProjectSettings } from '../../shared/projects/action-templates'
import { agentEnv } from '../agent/env'
import { fakeQueryFactory } from '../agent/fake-query'
import { draftSessionOptions, sessionHarnessPlugin } from '../agent/options'
import type { QueryHandle } from '../agent/session'
import { toEveryWindow } from '../broadcast'
import { clientOf } from '../clients'
import { bundledHarnessDir } from '../harness/bundled'
import { currentHarness, harnessHomes, locateHarness, scriptEnv } from '../harness/locate'
import { isRemoteCall } from '../link/caller'
import { ProjectConnector, type ConnectScript, type DraftQueryFactory } from '../projects/connect'
import { projectHolds } from '../projects/holds'
import { readProjectSettings, writeProjectSettings } from '../projects/settings'
import { projectStore, runGit } from '../projects/store'
import { claudeHome, harnessHome } from '../storage/paths'
import { profileRunner } from '../workflow/profile'
import { appInstaller } from './harness'
import { defineHandler, emit, type EventTarget, type HandlerModule } from './index'

const store = projectStore()

// ── connecting a Project (worfy-harness ticket 24, src/main/projects/connect.ts) ──────────────

/** How long bin/project-connect may take: the write commits in git and may set up qmd collections. */
const CONNECT_TIMEOUT_MS = 120_000
const MAX_OUTPUT = 1024 * 1024

/** `bin/project-connect` of the Harness on the machine, with the login shell's PATH (node) and HARNESS_HOME. */
const connectScript: ConnectScript = async (args, stdin) => {
  const env = (await agentEnv()).env
  const harness = locateHarness(harnessHomes(claudeHome()))
  return new Promise((resolve, reject) => {
    const child = spawn(join(harness.binDir, 'project-connect'), [...args], { env: scriptEnv(harness, env) as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), CONNECT_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(stdin)
  })
}

/** The draft Session's Claude Code: the SDK with the draft's options, as a Session outside every Project (no canvas). */
const sdkDraftQuery: DraftQueryFactory = async (request) => {
  const [{ query }, environment] = await Promise.all([import('@anthropic-ai/claude-agent-sdk'), agentEnv()])
  const options = draftSessionOptions({
    cwd: request.cwd,
    env: environment.env,
    runtime: { packaged: app.isPackaged, resourcesPath: process.resourcesPath, platform: process.platform, arch: process.arch },
    stderr: request.stderr,
    settings: request.settings,
    canUseTool: request.canUseTool,
    unattended: request.unattended,
    // The skill /worfy:connect-project comes with the Harness of this build, as in every Session.
    harnessPlugin: sessionHarnessPlugin(currentHarness().kind),
    outputFormat: request.outputFormat,
    allowedTools: request.allowedTools,
    disallowedTools: request.disallowedTools,
  })
  return query({ prompt: request.prompt, options }) as QueryHandle
}

/**
 * WORFY_AGENT=fake: the draft Session plays test/fixtures/agent-scripts/<WORFY_DRAFT_SCRIPT or
 * "profile-draft">.jsonl, and appends what it was asked to WORFY_AGENT_LOG, as app-registry.ts does.
 */
function draftQueryFromEnv(env: NodeJS.ProcessEnv = process.env): DraftQueryFactory {
  if (env.WORFY_AGENT !== 'fake') return sdkDraftQuery
  const log = env.WORFY_AGENT_LOG
  const fake = fakeQueryFactory({
    scriptsDir: env.WORFY_AGENT_SCRIPTS ?? join(app.getAppPath(), 'test', 'fixtures', 'agent-scripts'),
    script: env.WORFY_DRAFT_SCRIPT ?? 'profile-draft',
    record: log ? (call) => appendFileSync(log, `${JSON.stringify({ draft: true, ...call })}\n`) : undefined,
  })
  return (request) => fake(request)
}

const systemLanguage = (): 'ru' | 'en' => (app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en')

let sharedConnector: ProjectConnector | undefined

function connector(): ProjectConnector {
  sharedConnector ??= new ProjectConnector({
    git: runGit,
    profile: async (cwd, args) => profileRunner(claudeHome(), (await agentEnv()).env)(cwd, args),
    connect: connectScript,
    harness: () => appInstaller().status(),
    query: draftQueryFromEnv(),
    draftSchema: () => JSON.parse(readFileSync(join(bundledHarnessDir(), 'profiles', 'draft.schema.json'), 'utf8')) as Record<string, unknown>,
    reportsLanguage: systemLanguage,
    add: async (root) => {
      const added = await store.add(root)
      return added.status === 'added' ? { status: 'added', projectId: added.project.id, notice: added.notice } : added
    },
  })
  return sharedConnector
}

/** The list after an add, with the added Project's view. */
async function addedView(projectId: string, notice: string | null) {
  const state = await store.state()
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) throw new Error(`the added Project ${projectId} is not in the list`)
  return { status: 'added' as const, project, notice, state }
}

/** An event to the window that asked; a window already gone is skipped. */
function toSender(sender: EventTarget & { isDestroyed?: () => boolean }, send: (target: EventTarget) => void): void {
  if (sender.isDestroyed?.() === true) return
  try {
    send(sender)
  } catch (error) {
    console.warn('[projects] could not send to the window', error)
  }
}

// Every client hears about every change, whoever made it: a select from one window, or a later
// part of main that switches the Project. A client keeps the state with the highest revision, so
// two broadcasts that finish out of order do not roll the list back.
store.onChange(() => {
  void store
    .state()
    .then((state) => {
      toEveryWindow((client) => emit(client, projectsChanged, state))
    })
    .catch((error: unknown) => console.error('[projects] could not broadcast the change', error))
})

export default [
  defineHandler(projectsPickFolder, async (input, { event }) => {
    const options: Electron.OpenDialogOptions =
      input?.purpose === 'workflow-folder'
        ? {
            title: 'Workflow folder',
            message: 'Choose the folder for the tickets, specs, ADRs and the state file of the project',
            buttonLabel: 'Choose',
            properties: ['openDirectory', 'createDirectory'],
          }
        : {
            title: 'Add project',
            message: 'Choose the folder of a git repository, or the folder above the repositories of one project',
            buttonLabel: 'Add project',
            properties: ['openDirectory', 'createDirectory'],
          }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  }),

  defineHandler(projectsList, () => store.state()),

  // A Linked machine adds and removes Projects without switching the active one: that is the state
  // of this Machine's screens (projects.select is not open to it at all).
  defineHandler(projectsAdd, async ({ path }, { event }) => {
    const result = await store.add(path, { keepActive: isRemoteCall(event) })
    if (result.status === 'rejected') return result
    const state = await store.state()
    const project = state.projects.find((item) => item.id === result.project.id)
    if (!project) throw new Error(`the added Project ${result.project.id} is not in the list`)
    return { status: 'added' as const, project, notice: result.notice, state }
  }),

  // Connecting a Project: only this Machine's own screens (`local`).
  defineHandler(projectsConnectInspect, async ({ path }) => {
    const inspected = await connector().inspect(path)
    if (inspected.status === 'rejected') return inspected
    if (inspected.status === 'new') return { status: 'new' as const, folder: inspected.folder, harnessHome: harnessHome() }
    // The Harness knows the folder: it goes into the list as projects.add puts it, with its notices.
    const added = await store.add(path)
    if (added.status === 'rejected') return added
    return addedView(added.project.id, added.notice)
  }),

  defineHandler(projectsConnectDraft, (input, { event }) =>
    connector().draft(input, (text) => toSender(event.sender, (target) => emit(target, projectsConnectActivity, { draftId: input.draftId, text }))),
  ),

  defineHandler(projectsConnectStop, ({ draftId }) => ({ stopped: connector().stop(draftId) })),

  defineHandler(projectsConnectCheck, async ({ draft }) => ({ issues: await connector().check(draft) })),

  defineHandler(projectsConnectWrite, async ({ root, draft }) => {
    const written = await connector().write(root, draft)
    if (written.status !== 'added') return written
    return addedView(written.projectId, written.notice)
  }),

  defineHandler(projectsSelect, ({ id }) => {
    store.select(id)
    return store.state()
  }),

  defineHandler(projectsRemove, ({ id }, { event }) => {
    store.remove(id, { keepActive: isRemoteCall(event) })
    return store.state()
  }),

  // A screen of a Linked machine shows a Project of this Machine (worfy-link ticket 09): its
  // Orchestrator and documents stay open (projects/holds.ts); the active Project stays as it is.
  defineHandler(projectsHold, ({ screen, projectId }, { event }) => {
    const client = clientOf(event)
    if (client === undefined) throw new Error('the call came from no client')
    // Only a Project of the list: an unknown id throws here.
    const id = projectId === null ? null : store.get(projectId).id
    if (!projectHolds().set(client, screen, id)) throw new Error('the client is gone')
    return { projectId: id }
  }),

  defineHandler(projectsSettingsGet, ({ id }) => readProjectSettings(store.dataDir(store.get(id).id))),

  // The defaults of the Harness on the machine now: the old one's or the plugin's (worfy-harness ticket 12).
  defineHandler(projectsSettingsDefaults, () => defaultProjectSettings(currentHarness().kind)),

  defineHandler(projectsSettingsSet, ({ id, settings }) => {
    const saved = writeProjectSettings(store.dataDir(store.get(id).id), settings)
    toEveryWindow((client) => emit(client, projectsSettingsChanged, { id, settings: saved }))
    return saved
  }),
] satisfies HandlerModule
