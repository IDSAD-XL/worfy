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
  projectsReviewerBuild,
  projectsReviewerDelete,
  projectsReviewerGet,
  projectsReviewerLater,
  projectsReviewerOffer,
  projectsSelect,
  projectsSettingsChanged,
  projectsSettingsDefaults,
  projectsSettingsGet,
  projectsSettingsSet,
  type ProjectsState,
} from '../../shared/ipc/projects'
import { defaultProjectSettings } from '../../shared/projects/action-templates'
import type { VendorId } from '../../shared/vendors/vendor'
import { agentEnv } from '../agent/env'
import { fakeQueryFactory } from '../agent/fake-query'
import { toEveryWindow } from '../broadcast'
import { clientOf, type Client } from '../clients'
import { signInRegistry, type GhProgram } from '../github/accounts'
import { accountAuth, ghRunner } from '../github/prs'
import { bundledHarnessDir } from '../harness/bundled'
import { currentHarness, harnessHomes, locateHarness, profileRegistryFiles, scriptEnv } from '../harness/locate'
import { harnessScriptEnv } from '../harness/script-env'
import { layoutStore } from '../layout/store'
import { isRemoteCall, localProjectRefusal, setLocalProjects } from '../link/caller'
import { browseFolder } from '../projects/browse'
import { connectScriptRunner, ProjectConnector, type ConnectScript } from '../projects/connect'
import { projectHolds } from '../projects/holds'
import { deleteTeamReviewer, offerTeamReviewer, privateFolder, probeRunner, readProfileDir, readTeamReviewer } from '../projects/review-offer'
import { readProjectSettings, writeHumanReviewOffer, writeProjectSettings } from '../projects/settings'
import { projectStore, runGit } from '../projects/store'
import { claudeHome, harnessHome } from '../storage/paths'
import type { TerminalRegistry } from '../terminal/pty'
import { claudeOneShotOver } from '../vendors/claude/one-shot'
import type { OneShot } from '../vendors/one-shot'
import { vendorDriver } from '../vendors/registry'
import { profileRunner, readGithubAccount } from '../workflow/profile'
import { appInstaller } from './harness'
import { defineHandler, emit, type EventTarget, type HandlerModule } from './index'

const store = projectStore()

// ── connecting a Project (worfy-harness ticket 24, src/main/projects/connect.ts) ──────────────

let quitting: AbortController | undefined

/**
 * Aborted when the app quits: the Harness scripts of this module still running then are killed.
 * Subscribed on the first run of a script, so loading the module touches no app event.
 */
function quitSignal(): AbortSignal {
  if (quitting === undefined) {
    const controller = new AbortController()
    app.on('will-quit', () => controller.abort())
    quitting = controller
  }
  return quitting.signal
}

/**
 * `bin/project-connect` of the Harness on the machine, with the login shell's PATH (node) and
 * HARNESS_HOME, started as `node <script>` by the shared launcher (worfy-windows ticket 30). The
 * write may run for up to 30 minutes and has no Stop of its own: a script still running when the
 * app quits is killed (will-quit, as the other children of this module are ended).
 */
function appConnectScript(): ConnectScript {
  return connectScriptRunner({
    harness: () => locateHarness(harnessHomes(claudeHome())),
    env: async () => (await agentEnv()).env,
    signal: quitSignal,
  })
}

/** The gate registry files the machine's bin/profile reads, with the environment it runs with. */
const gateRegistries = async (): Promise<string[]> => profileRegistryFiles(scriptEnv(locateHarness(harnessHomes(claudeHome())), (await agentEnv()).env))

/**
 * The Vendor whose agent writes the draft of a Project's profile: Claude Code, which the first release
 * needs for the draft (spec decision 6 of worfy-multi-vendor; a draft on Codex comes with a Codex-only
 * user, outside that Epic).
 */
export const DRAFT_VENDOR: VendorId = 'claude'

/**
 * The single request of the draft: the oneShot part of DRAFT_VENDOR's driver. Under WORFY_AGENT=fake the
 * Claude driver's oneShot over the fake agent, which plays test/fixtures/agent-scripts/<WORFY_DRAFT_SCRIPT
 * or "profile-draft">.jsonl and appends what it was asked to WORFY_AGENT_LOG, as the Sessions' query does
 * (src/main/vendors/claude/query.ts).
 */
export function draftOneShotFromEnv(env: NodeJS.ProcessEnv = process.env): OneShot {
  if (env.WORFY_AGENT !== 'fake') return (prompt, opts) => vendorDriver(DRAFT_VENDOR).oneShot(prompt, opts)
  const log = env.WORFY_AGENT_LOG
  const fake = fakeQueryFactory({
    scriptsDir: env.WORFY_AGENT_SCRIPTS ?? join(app.getAppPath(), 'test', 'fixtures', 'agent-scripts'),
    script: env.WORFY_DRAFT_SCRIPT ?? 'profile-draft',
    record: log ? (call) => appendFileSync(log, `${JSON.stringify({ draft: true, ...call })}\n`) : undefined,
  })
  return claudeOneShotOver((request) => fake(request))
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
    oneShot: draftOneShotFromEnv(),
    draftSchema: () => JSON.parse(readFileSync(join(bundledHarnessDir(), 'profiles', 'draft.schema.json'), 'utf8')) as Record<string, unknown>,
    reportsLanguage: systemLanguage,
    add: async (root, options) => {
      const added = await store.add(root, options)
      return added.status === 'added' ? { status: 'added', projectId: added.project.id, notice: added.notice } : added
    },
  })
  return sharedConnector
}

// ── the team reviewer (worfy-human-review ticket 09, src/main/projects/review-offer.ts) ─────────

/** The Profile folder of the Project at `root`, through the Harness on the machine. */
const appProfileDir = async (root: string): Promise<string> => readProfileDir(profileRunner(claudeHome(), await harnessScriptEnv()), root)

/** GH_TOKEN of the Profile's GitHub account, as the PR badges take it; none when the Profile names no account. */
async function reviewGhEnv(root: string): Promise<Record<string, string>> {
  const env = await harnessScriptEnv()
  const account = async (folder: string): Promise<string | null> => (await readGithubAccount({ root: folder, claudeHome: claudeHome(), env, log: () => undefined })).account
  const token = await accountAuth({ account, run: ghRunner(appGh()) })(root)
  return token.GH_TOKEN === undefined ? {} : { GH_TOKEN: token.GH_TOKEN }
}

/**
 * The probe's environment: the Harness scripts' one, and with WORFY_GH (the gh stand-in of the tests)
 * that same program as review-history's gh, so a test's probe never reaches GitHub either.
 */
async function probeEnv(): Promise<Record<string, string | undefined>> {
  const stub = process.env.WORFY_GH
  return { ...(await harnessScriptEnv()), ...(stub ? { REVIEW_HISTORY_GH: stub } : {}) }
}

const probe = probeRunner({ harness: () => locateHarness(harnessHomes(claudeHome())), env: probeEnv, ghEnv: reviewGhEnv, signal: quitSignal })

/** The offers still asking the Harness; a test waits for them with settleReviewOffers. */
const offering = new Set<Promise<boolean>>()

/**
 * The offer for a Project just put into the list, in the background: only for a folder new to the
 * list (`before`: the ids listed before the add). The windows hear projects.reviewer.offer.
 */
function offerAfterAdd(projectId: string, before: ReadonlySet<string>): void {
  if (before.has(projectId)) return
  const root = store.get(projectId).path
  const task = offerTeamReviewer(
    {
      probe,
      answered: (id) => readProjectSettings(store.dataDir(store.get(id).id)).humanReview?.offer === 'later',
      profileDir: appProfileDir,
      emit: (id) => toEveryWindow((client) => emit(client, projectsReviewerOffer, { projectId: id })),
    },
    projectId,
    root,
  ).finally(() => offering.delete(task))
  offering.add(task)
}

/** Settles when every offer started so far has answered; for tests. */
export async function settleReviewOffers(): Promise<void> {
  while (offering.size > 0) await Promise.all([...offering])
}

const listedIds = (): Set<string> => new Set(store.list().map((project) => project.id))

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
  // A folder that names a Project local to this Machine in a way the link adapter did not catch
  // (another spelling of it) is refused to a Linked machine here, before its view goes out.
  const stored = store.find(projectId)
  if (stored?.localOnly === true && isRemoteCall(event)) throw new Error(localProjectRefusal(stored.name))
  const states = await store.states()
  const project = states.all.projects.find((item) => item.id === projectId)
  if (!project) throw new Error(`the added Project ${projectId} is not in the list`)
  return { status: 'added' as const, project, notice, state: visibleTo(event, states) }
}

/**
 * The list as the caller may see it: a Linked machine's call gets it without the Projects local to
 * this Machine (ProjectStore.states), a window's call gets it whole.
 */
function visibleTo(event: { readonly sender?: unknown }, states: { all: ProjectsState; linked: ProjectsState }): ProjectsState {
  return isRemoteCall(event) ? states.linked : states.all
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
    .states()
    .then((states) => {
      toEveryWindow((client) => emit(client, projectsChanged, visibleTo({ sender: client }, states)))
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

  defineHandler(projectsList, async (_input, { event }) => visibleTo(event, await store.states())),

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
    const before = listedIds()
    const added = await store.add(path, { keepActive: isRemoteCall(event) })
    if (added.status === 'rejected') return added
    const view = await addedView(added.project.id, added.notice, event)
    offerAfterAdd(added.project.id, before)
    return view
  }),

  defineHandler(projectsConnectDraft, (input, { event }) =>
    connector().draft(input, (text) => toSender(event.sender, (target) => emit(target, projectsConnectActivity, { draftId: input.draftId, text }))),
  ),

  defineHandler(projectsConnectStop, ({ draftId }) => ({ stopped: connector().stop(draftId) })),

  defineHandler(projectsConnectCheck, async ({ draft }) => ({ issues: await connector().check(draft) })),

  defineHandler(projectsConnectWrite, async ({ root, draft }, { event }) => {
    const before = listedIds()
    const written = await connector().write(root, draft, { keepActive: isRemoteCall(event) })
    if (written.status !== 'added') return written
    const view = await addedView(written.projectId, written.notice, event)
    offerAfterAdd(written.projectId, before)
    return view
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
    return visibleTo(event, await store.states())
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

  // The team reviewer (worfy-human-review ticket 09): its state in the Profile's private folder,
  // "Build", "Delete", and "Later" of the offer.
  defineHandler(projectsReviewerGet, async ({ id }) => {
    const root = store.get(id).path
    try {
      return readTeamReviewer(privateFolder(await appProfileDir(root)))
    } catch (error) {
      return { status: 'unavailable' as const, reason: error instanceof Error ? error.message : String(error) }
    }
  }),

  defineHandler(projectsReviewerBuild, async ({ id }) => {
    const { sharedLauncher } = await import('./actions')
    const { nodeId, sessionId } = sharedLauncher().buildTeamReviewer(store.get(id).id)
    return { nodeId, sessionId }
  }),

  defineHandler(projectsReviewerDelete, async ({ id }) => {
    const profileDir = await appProfileDir(store.get(id).path)
    deleteTeamReviewer(profileDir)
    return readTeamReviewer(privateFolder(profileDir))
  }),

  defineHandler(projectsReviewerLater, ({ id }) => {
    const saved = writeHumanReviewOffer(store.dataDir(store.get(id).id), 'later')
    toEveryWindow((client) => emit(client, projectsSettingsChanged, { id, settings: saved }))
    return saved
  }),
] satisfies HandlerModule
