import { appendFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import {
  projectsAdd,
  projectsBrowse,
  projectsChanged,
  projectsConnectAccounts,
  projectsConnectActivity,
  projectsConnectCheck,
  projectsConnectDraft,
  projectsConnectInspect,
  projectsConnectSignIn,
  projectsConnectSignInClose,
  projectsConnectSignInExit,
  projectsConnectSignInInput,
  projectsConnectSignInOutput,
  projectsConnectSignInResize,
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
  type ProjectsState,
} from '../../shared/ipc/projects'
import { defaultProjectSettings } from '../../shared/projects/action-templates'
import { agentEnv } from '../agent/env'
import { fakeQueryFactory } from '../agent/fake-query'
import { draftSessionOptions, sessionHarnessPlugin } from '../agent/options'
import type { QueryHandle } from '../agent/session'
import { toEveryWindow } from '../broadcast'
import { clientOf, type Client } from '../clients'
import { signInRegistry, type GhProgram } from '../github/accounts'
import { ghRunner } from '../github/prs'
import { bundledHarnessDir } from '../harness/bundled'
import { currentHarness, harnessHomes, locateHarness, profileRegistryFiles, scriptEnv } from '../harness/locate'
import { layoutStore } from '../layout/store'
import { isRemoteCall, setLocalProjects } from '../link/caller'
import { browseFolder } from '../projects/browse'
import { connectScriptRunner, ProjectConnector, type ConnectScript, type DraftQueryFactory } from '../projects/connect'
import { projectHolds } from '../projects/holds'
import { readProjectSettings, writeProjectSettings } from '../projects/settings'
import { projectStore, runGit } from '../projects/store'
import { claudeHome, harnessHome } from '../storage/paths'
import type { TerminalRegistry } from '../terminal/pty'
import { profileRunner } from '../workflow/profile'
import { appInstaller } from './harness'
import { defineHandler, emit, type EventTarget, type HandlerModule } from './index'

const store = projectStore()

// ── connecting a Project (worfy-harness ticket 24, src/main/projects/connect.ts) ──────────────

/**
 * `bin/project-connect` of the Harness on the machine, with the login shell's PATH (node) and
 * HARNESS_HOME, started as `node <script>` by the shared launcher (worfy-windows ticket 30). The
 * write may run for up to 30 minutes and has no Stop of its own: a script still running when the
 * app quits is killed (will-quit, as the other children of this module are ended).
 */
function appConnectScript(): ConnectScript {
  let quitting: AbortController | undefined
  // Subscribed on the first run of the script, so building the connector touches no app event.
  const quitSignal = (): AbortSignal => {
    if (quitting === undefined) {
      const controller = new AbortController()
      app.on('will-quit', () => controller.abort())
      quitting = controller
    }
    return quitting.signal
  }
  return connectScriptRunner({
    harness: () => locateHarness(harnessHomes(claudeHome())),
    env: async () => (await agentEnv()).env,
    signal: quitSignal,
  })
}

/** The gate registry files the machine's bin/profile reads, with the environment it runs with. */
const gateRegistries = async (): Promise<string[]> => profileRegistryFiles(scriptEnv(locateHarness(harnessHomes(claudeHome())), (await agentEnv()).env))

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

/**
 * The app's gh, as the PR badges run it (src/main/ipc/checks.ts): WORFY_GH (a stub in tests) with
 * the app's own environment, else `gh` with the login shell's environment.
 */
function appGh(): GhProgram {
  const stub = process.env.WORFY_GH
  return stub ? { command: stub, env: () => Promise.resolve(process.env) } : { env: async () => (await agentEnv()).env }
}

let sharedConnector: ProjectConnector | undefined

function connector(): ProjectConnector {
  sharedConnector ??= new ProjectConnector({
    git: runGit,
    gh: ghRunner(appGh()),
    profile: async (cwd, args) => profileRunner(claudeHome(), (await agentEnv()).env)(cwd, args),
    gateRegistries,
    connect: appConnectScript(),
    harness: () => appInstaller().status(),
    query: draftQueryFromEnv(),
    draftSchema: () => JSON.parse(readFileSync(join(bundledHarnessDir(), 'profiles', 'draft.schema.json'), 'utf8')) as Record<string, unknown>,
    reportsLanguage: systemLanguage,
    add: async (root, options) => {
      const added = await store.add(root, options)
      return added.status === 'added' ? { status: 'added', projectId: added.project.id, notice: added.notice } : added
    },
  })
  return sharedConnector
}

// "Sign in with gh" of the account step: `gh auth login` in a pseudo-terminal of its own, through
// the Terminal Nodes' registry (replay, size, SIGHUP then SIGKILL on close), but with gh itself as
// the process instead of a shell: there is no Project and no Canvas yet when a Project is being
// connected. One sign-in per id; it ends when the dialog closes it, when the window that opened it
// goes, or when the app quits.

let appSignIns: TerminalRegistry | null = null

function signIns(): TerminalRegistry {
  if (appSignIns !== null) return appSignIns
  const registry = signInRegistry(appGh())
  app.on('will-quit', () => void registry.closeAll().catch((error: unknown) => console.warn('[projects] ending the gh sign-in failed', error)))
  appSignIns = registry
  return registry
}

const watchedSignIn = new WeakSet<Client>()

/** The client's sign-ins end when it goes. */
function watchSignIn(client: Client): void {
  if (watchedSignIn.has(client)) return
  watchedSignIn.add(client)
  client.once('destroyed', () => void signIns().leave(client).catch((error: unknown) => console.warn('[projects] ending the gh sign-in of a closed window failed', error)))
}

/** The list after an add, with the added Project's view. */
async function addedView(projectId: string, notice: string | null, event: { readonly sender?: unknown }) {
  const state = await store.state()
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) throw new Error(`the added Project ${projectId} is not in the list`)
  return { status: 'added' as const, project, notice, state: visibleTo(event, state) }
}

/**
 * The list as the caller may see it: a Linked machine's call gets it without the Projects local to
 * this Machine (ProjectStore.forLinkedMachine), a window's call gets it whole.
 */
function visibleTo(event: { readonly sender?: unknown }, state: ProjectsState): ProjectsState {
  return isRemoteCall(event) ? store.forLinkedMachine(state) : state
}

// The link adapter refuses a call, and a link client an event, that names one of these (link/caller.ts).
setLocalProjects(() => store.list().filter((project) => project.localOnly === true))

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
// A client of a link connection gets the list without the Projects local to this Machine.
store.onChange(() => {
  void store
    .state()
    .then((state) => {
      let linked: ProjectsState | undefined
      toEveryWindow((client) => emit(client, projectsChanged, isRemoteCall({ sender: client }) ? (linked ??= store.forLinkedMachine(state)) : state))
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

  defineHandler(projectsList, async (_input, { event }) => visibleTo(event, await store.state())),

  // The folders of a folder of this Machine (worfy-link ticket 11): "Add project" of a Linked
  // machine's screen picks a folder here this way. The whole disk, from the home folder; reads names only.
  defineHandler(projectsBrowse, ({ path }) => browseFolder(path)),

  // A Linked machine adds and removes Projects without switching the active one: that is the state
  // of this Machine's screens (projects.select is not open to it at all).
  defineHandler(projectsAdd, async ({ path }, { event }) => {
    const result = await store.add(path, { keepActive: isRemoteCall(event) })
    if (result.status === 'rejected') return result
    return addedView(result.project.id, result.notice, event)
  }),

  // Connecting a Project: this Machine's screens, and a Linked machine while access is on
  // (worfy-link ticket 11). A folder a Linked machine adds does not become the active Project here.
  defineHandler(projectsConnectInspect, async ({ path }, { event }) => {
    const inspected = await connector().inspect(path)
    if (inspected.status === 'rejected') return inspected
    if (inspected.status === 'new') return { status: 'new' as const, folder: inspected.folder, harnessHome: harnessHome() }
    // The Harness knows the folder: it goes into the list as projects.add puts it, with its notices.
    const added = await store.add(path, { keepActive: isRemoteCall(event) })
    if (added.status === 'rejected') return added
    return addedView(added.project.id, added.notice, event)
  }),

  defineHandler(projectsConnectDraft, (input, { event }) =>
    connector().draft(input, (text) => toSender(event.sender, (target) => emit(target, projectsConnectActivity, { draftId: input.draftId, text }))),
  ),

  defineHandler(projectsConnectStop, ({ draftId }) => ({ stopped: connector().stop(draftId) })),

  defineHandler(projectsConnectCheck, async ({ draft }) => ({ issues: await connector().check(draft) })),

  defineHandler(projectsConnectWrite, async ({ root, draft }, { event }) => {
    const written = await connector().write(root, draft, { keepActive: isRemoteCall(event) })
    if (written.status !== 'added') return written
    return addedView(written.projectId, written.notice, event)
  }),

  defineHandler(projectsConnectAccounts, ({ root }) => connector().accounts(root)),

  defineHandler(projectsConnectSignIn, async ({ signInId, cols, rows }, { event }) => {
    const client = clientOf(event)
    if (client === undefined || client.isDestroyed()) throw new Error('projects.connect.signIn needs the window that calls it')
    watchSignIn(client)
    const alive = (): boolean => !client.isDestroyed()
    const opened = await signIns().open(signInId, { cwd: homedir(), cols, rows }, client, {
      output: (data, end) => {
        if (alive()) emit(client, projectsConnectSignInOutput, { signInId, data, end })
      },
      exit: (exitCode, signal) => {
        if (alive()) emit(client, projectsConnectSignInExit, { signInId, exitCode, signal })
      },
      started: () => undefined,
    })
    if (client.isDestroyed()) void signIns().leave(client)
    return { replay: opened.replay, end: opened.end, sizes: opened.sizes, exited: opened.exited }
  }),

  defineHandler(projectsConnectSignInInput, ({ signInId, data, reply }, { event }) => {
    signIns().write(signInId, data, clientOf(event), { reply: reply === true })
  }),

  defineHandler(projectsConnectSignInResize, ({ signInId, cols, rows }, { event }) => {
    signIns().resize(signInId, cols, rows, clientOf(event))
  }),

  defineHandler(projectsConnectSignInClose, async ({ signInId }) => {
    await signIns().close(signInId)
  }),

  defineHandler(projectsSelect, ({ id }) => {
    store.select(id)
    return store.state()
  }),

  // The Layout is written a moment after its last change, to a path the list of Projects gives:
  // what is still waiting is written now, while the Project is in the list, and its Layout is
  // forgotten once it is out (worfy-windows ticket 31). A refused remove (a Linked machine and the
  // active Project) throws before the forget; the write before it changes nothing.
  defineHandler(projectsRemove, async ({ id }, { event }) => {
    layoutStore().flush(id)
    store.remove(id, { keepActive: isRemoteCall(event) })
    layoutStore().forget(id)
    return visibleTo(event, await store.state())
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
