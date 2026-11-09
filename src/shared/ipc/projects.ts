// The `projects` domain: the list of Projects, the active one, and each Project's settings.
// Handled in src/main/ipc/projects.ts (ADR-0006).
import { z } from 'zod'
import { projectSettingsAnswerSchema, projectSettingsInputSchema } from '../projects/action-templates'
import { eventChannel, invokeChannel } from './channels'
import { replaySizeSchema, sizesInOrder } from './terminal'

/** A Project as the renderer sees it. */
export const projectViewSchema = z.object({
  /** Stable id, also the name of the Project's data folder: `<folder name>-<sha256(path)[0:8]>`. */
  id: z.string().min(1),
  /** The repository folder name. */
  name: z.string().min(1),
  /** Absolute path of the repository root. */
  path: z.string().min(1),
  /** The checked-out branch (`HEAD` when detached); null when git cannot read the repository. */
  branch: z.string().nullable(),
})
export type ProjectView = z.output<typeof projectViewSchema>

export const projectsStateSchema = z.object({
  projects: z.array(projectViewSchema),
  activeId: z.string().nullable(),
  /** Grows with every change in main; a client keeps the state with the highest revision. */
  revision: z.number().int().nonnegative(),
})
export type ProjectsState = z.output<typeof projectsStateSchema>

const projectId = z.object({ id: z.string().min(1) })

/**
 * Opens the system folder picker; null when the user cancels. `purpose` words the picker: the folder
 * of a Project (the default), or the Workflow folder of a Silent mode Project (worfy-harness ticket 24).
 */
export const projectsPickFolder = invokeChannel(
  'projects.pickFolder',
  z.object({ purpose: z.enum(['project', 'workflow-folder']) }).optional(),
  z.object({ path: z.string().nullable() }),
  'desktop',
)

export const projectsList = invokeChannel('projects.list', z.void(), projectsStateSchema, 'project', 'read')

/** One folder of a browsed folder: its path in the form of the Machine's OS, as the Machine gave it. */
export const browsedFolderSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  /** The name starts with a dot. */
  hidden: z.boolean(),
  /** Holds a `.git` (a folder, or the file of a linked worktree); git is not run. */
  gitRepo: z.boolean(),
})
export type BrowsedFolder = z.output<typeof browsedFolderSchema>

export const browseAnswerSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    path: z.string().min(1),
    /** The folder above; null at a root. */
    parent: z.string().min(1).nullable(),
    /** Only folders (a symbolic link to a folder too), by name; at most 2000. */
    folders: z.array(browsedFolderSchema),
    /** More than 2000 folders: the first 2000 by name are here. */
    truncated: z.boolean(),
  }),
  /** The folder cannot be read (no permission, gone): the reason, and its parent to go up. */
  z.object({ ok: z.literal(false), path: z.string().min(1), parent: z.string().min(1).nullable(), reason: z.string().min(1) }),
])
export type BrowseAnswer = z.output<typeof browseAnswerSchema>

/**
 * The folders of one folder of the Machine called (src/main/projects/browse.ts): how a screen of a
 * Linked machine picks a folder for "Add project" there (worfy-link ticket 11), since the system
 * picker of a Machine opens only on its own screen. `null` is the start: the home folder. The whole
 * disk is open (decided without the owner, to confirm): a Linked machine with access on already runs
 * a Terminal there. Paths are in the form of that Machine's OS; the screen goes on only by `path`
 * and `parent` of an answer and never parses or joins them. Only while access is on (`project`).
 */
export const projectsBrowse = invokeChannel('projects.browse', z.object({ path: z.string().min(1).nullable() }), browseAnswerSchema, 'project', 'write')

/**
 * Adds the git repository that contains `path` and makes it active. A subfolder or a linked
 * worktree is resolved to the repository root, and `notice` says so. A folder outside any git
 * repository is not an error of the call: it is answered with `status: 'rejected'` and a reason
 * that the UI shows as it is.
 */
export const projectsAdd = invokeChannel(
  'projects.add',
  z.object({ path: z.string().min(1) }),
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('added'), project: projectViewSchema, notice: z.string().nullable(), state: projectsStateSchema }),
    z.object({ status: z.literal('rejected'), reason: z.string().min(1) }),
  ]),
  'project',
  'write',
)

export const projectsSelect = invokeChannel('projects.select', projectId, projectsStateSchema, 'local')

/** Removes the Project from the list; its data folder stays. */
export const projectsRemove = invokeChannel('projects.remove', projectId, projectsStateSchema, 'project', 'write')

// "Remove project…" (worfy-polish ticket 79, src/main/projects/remove.ts): the Project leaves this
// Machine's Harness too — its Profile, its gate registry entries, the agents' marks and its qmd
// collections, through `project-connect --remove` — so its folders can be connected again. The
// repositories, their files and the user's tickets are never touched. `local`: only the screen of
// the Machine whose Harness it is removes a Project from it; a Linked machine has "Remove from list".

/** What "Remove project…" would remove and what stays; `refused` when the Project cannot be removed so. */
export const removalPreviewSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    /** The Profile's name, and the folder `project-connect --remove` deletes. */
    profile: z.string().min(1),
    profileDir: z.string().min(1),
    /** The paths of its gate registry entries: freed for a new connection. */
    paths: z.array(z.string()),
    /** The agents' marks of the Profile, `<Harness home>/runs/<profile>/`. */
    runs: z.string().min(1),
    /** The qmd collections the Profile names; one another Profile names too stays. */
    qmd: z.array(z.string()),
    mode: z.enum(['full', 'silent']),
    /**
     * The Workflow folder of a Silent mode Profile; null in Full mode. `inside`: the default one, in
     * the Profile folder (removed with it while it is empty); otherwise the user's own folder, which stays.
     */
    workflowFolder: z.object({ path: z.string().min(1), inside: z.boolean(), holdsFiles: z.boolean() }).nullable(),
  }),
  z.object({ status: z.literal('refused'), reason: z.string().min(1) }),
])
export type RemovalPreview = z.output<typeof removalPreviewSchema>

export const projectsRemovalPreview = invokeChannel('projects.removal.preview', projectId, removalPreviewSchema, 'local')

/**
 * Removes the Project from the Harness of this Machine, then from the list. A refusal of the Harness
 * leaves the Project in the list, with the script's words; `workflowFolder` names the default Workflow
 * folder when it holds the project's own files, so the dialog can show it in Finder.
 */
export const projectsRemoveProject = invokeChannel(
  'projects.removeProject',
  projectId,
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('removed'), state: projectsStateSchema, notes: z.array(z.string()) }),
    z.object({ status: z.literal('refused'), reason: z.string().min(1), workflowFolder: z.string().nullable() }),
  ]),
  'local',
)

/**
 * Shows the default Workflow folder of the Project's Profile in the file manager of this Machine (the
 * path is main's own, never the window's). `local`, like the removal it belongs to.
 */
export const projectsRemovalReveal = invokeChannel('projects.removal.reveal', projectId, z.object({ path: z.string() }), 'local')

export const projectsSettingsGet = invokeChannel('projects.settings.get', projectId, projectSettingsAnswerSchema, 'project', 'read')

/** Saves the settings; a template with an unknown placeholder fails the input schema. */
export const projectsSettingsSet = invokeChannel(
  'projects.settings.set',
  z.object({ id: z.string().min(1), settings: projectSettingsInputSchema }),
  projectSettingsAnswerSchema,
  'project',
  'write',
)

/**
 * The default settings for the Harness found on the machine now (worfy-harness ticket 12): what
 * "Reset to default" puts into the fields. Main looks for the Harness on every call.
 */
export const projectsSettingsDefaults = invokeChannel('projects.settings.defaults', z.void(), projectSettingsAnswerSchema, 'project', 'read')

/**
 * A screen of a Linked machine shows Project `projectId` of this Machine (null: none any more;
 * worfy-link ticket 09). `screen` names the screen among those of the calling client. While some
 * screen shows a Project, this Machine keeps its Orchestrator and its documents open, as it does
 * for its active Project; a client that leaves (its connection closed, access switched off) lets
 * go of all its screens. The active Project of this Machine does not change.
 */
export const projectsHold = invokeChannel(
  'projects.hold',
  z.object({ screen: z.string().min(1).max(100), projectId: z.string().min(1).nullable() }),
  z.object({ projectId: z.string().nullable() }),
  'project',
  'write',
)

/** Sent to every window after a Project's settings were saved, so the action buttons (ticket 23) follow at once. */
export const projectsSettingsChanged = eventChannel('projects.settings.changed', z.object({ id: z.string().min(1), settings: projectSettingsAnswerSchema }), 'project', 'read')

/** Sent to every window after any change of the list or of the active Project. */
export const projectsChanged = eventChannel('projects.changed', projectsStateSchema, 'project', 'read')

// ── the team reviewer (worfy-human-review ticket 09) ─────────────────────────
// A Project's reviewer skill in its team's voice lives in the private folder of its Profile,
// <Profile folder>/state/human-review/ (src/main/projects/review-offer.ts); worfy reads it, starts the
// generator skill that writes it, and deletes it on the user's word.

/**
 * The team reviewer as "Project settings…" shows it. `built`: the reviewer skill is there; `builtAt`
 * is when it was written (ISO), `pullRequests` how many pull requests its history read (null when
 * meta.json does not say). `short`: the last read found too little history for a voice —
 * `substantive` of `threshold` comments. `none`: neither. `unavailable`: the Profile folder cannot be
 * found, with the reason.
 */
export const teamReviewerStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('none') }),
  z.object({ status: z.literal('built'), builtAt: z.string().min(1), pullRequests: z.number().int().nonnegative().nullable() }),
  z.object({ status: z.literal('short'), substantive: z.number().int().nonnegative(), threshold: z.number().int().positive() }),
  z.object({ status: z.literal('unavailable'), reason: z.string() }),
])
export type TeamReviewerState = z.output<typeof teamReviewerStateSchema>

/** The team reviewer of a Project: reads its private folder, changes nothing. */
export const projectsReviewerGet = invokeChannel('projects.reviewer.get', projectId, teamReviewerStateSchema, 'project', 'read')

/**
 * "Build": a new Session Node in the Project's root, on Claude Code, whose first message is the
 * generator skill (TEAM_REVIEWER_COMMAND), as "Ship ticket" starts one. `refresh: true` — "Update"
 * (worfy-human-review ticket 10): the first message is TEAM_REVIEWER_REFRESH_COMMAND instead.
 */
export const projectsReviewerBuild = invokeChannel(
  'projects.reviewer.build',
  projectId.extend({ refresh: z.boolean().optional() }),
  z.object({ nodeId: z.string().min(1), sessionId: z.string().min(1) }),
  'project',
  'write',
)

/** "Delete": erases the private folder of the team reviewer, and only it; answers the state after. */
export const projectsReviewerDelete = invokeChannel('projects.reviewer.delete', projectId, teamReviewerStateSchema, 'project', 'write')

/**
 * "Later", or the offer's toast closed: `humanReview.offer: "later"` in the Project's settings, so the
 * offer is not made again. Answers the settings as saved; every window hears projects.settings.changed.
 */
export const projectsReviewerLater = invokeChannel('projects.reviewer.later', projectId, projectSettingsAnswerSchema, 'project', 'write')

/**
 * Asked by a window that made the Project active (worfy-human-review ticket 10): whether to show the
 * reminder to update the team reviewer. `due` when the reviewer is built and more than 30 days old,
 * and no reminder was shown in the last 30 days; a due one is recorded as `humanReview.remindedAt`
 * in the Project's settings before the answer, so it comes once. `write`: it writes those settings.
 */
export const projectsReviewerRemind = invokeChannel('projects.reviewer.remind', projectId, z.object({ due: z.boolean() }), 'project', 'write')

/**
 * Sent to every window when a Project just added has review history enough for a voice
 * (`review-history probe`: `voice: yes`) and its offer was never answered: the window shows the
 * offer's toast. `read`, as every event but a Terminal's output and a Browser's frames: a window on a
 * Linked machine with read-only access hears it and shows no toast, since its buttons write.
 */
export const projectsReviewerOffer = eventChannel('projects.reviewer.offer', z.object({ projectId: z.string().min(1) }), 'project', 'read')

// ── connecting a Project (worfy-harness ticket 24) ─────────────────────────────
//
// "Add project" is one dialog in steps: the folder (projects.connect.inspect), the mode and the
// Workflow folder, the Harness check and the draft Session (projects.connect.draft), the form
// (projects.connect.check) and the write through the Harness's bin/project-connect
// (projects.connect.write). Nothing is written before the last step.
//
// They are `project` (worfy-link ticket 11): "Add project" on a Linked machine runs every step on
// that Machine — its folder, its Harness, its draft Session, its Profile and gate registry — so a
// Linked machine reaches them only while "Linked machines can work with my Projects" is on. A folder
// added for a Linked machine does not become this Machine's active Project. The gh sign-in below
// stays `local`: it types into a terminal of the Machine whose screen shows it.

/** One git repository of a folder: its folder name and its absolute root. */
export const connectRepoSchema = z.object({ name: z.string().min(1), path: z.string().min(1) })

/**
 * What kind of folder the user picked: a git repository (`root` is its root; a subfolder or a linked
 * worktree is resolved to it, and `notice` says so), or a folder that is not in git itself and holds
 * two or more git repositories as direct subfolders (`multi-repo`, ADR-0045).
 */
export const connectFolderSchema = z.object({
  kind: z.enum(['git', 'multi-repo']),
  root: z.string().min(1),
  /** The repositories: the one of a git folder, every one of a multi-repo folder, by name. */
  repos: z.array(connectRepoSchema),
  notice: z.string().nullable(),
  /**
   * The root lies inside %TEMP% of Windows, where Storage Sense may delete files (worfy-windows
   * ticket 61): the Folder step warns. Set only by step 1, and only when true; adding stays allowed.
   */
  insideTemp: z.literal(true).optional(),
})
export type ConnectFolder = z.output<typeof connectFolderSchema>

export const connectModeSchema = z.enum(['full', 'silent'])
export type ConnectMode = z.output<typeof connectModeSchema>

/**
 * A draft of the connection, by harness/profiles/draft.schema.json: profile.json, the text of
 * rules.md and the gate registry entries. Its fields are checked by bin/project-connect, not here.
 */
export const profileDraftSchema = z.object({
  profile: z.record(z.string(), z.unknown()),
  rules: z.string(),
  gate: z.array(z.record(z.string(), z.unknown())),
})
export type ProfileDraft = z.output<typeof profileDraftSchema>

/** A problem bin/project-connect found, at a path of the draft (`profile.commands.test`, `gate[0].match`). */
export const draftIssueSchema = z.object({ path: z.string(), kind: z.string(), message: z.string() })
export type DraftIssue = z.output<typeof draftIssueSchema>

const addedSchema = z.object({ status: z.literal('added'), project: projectViewSchema, notice: z.string().nullable(), state: projectsStateSchema })

/**
 * Step 1: the kind of the folder, only read. A folder the Harness already knows (`bin/profile -C`
 * exits 0) is added to the list at once, as projects.add does (`added`); a new one answers what the
 * dialog needs next (`new`): the folder, and where the Harness keeps its state, for the default
 * Workflow folder `<harnessHome>/projects/<name>/workflow/`.
 */
export const projectsConnectInspect = invokeChannel(
  'projects.connect.inspect',
  z.object({ path: z.string().min(1) }),
  z.discriminatedUnion('status', [
    addedSchema,
    z.object({ status: z.literal('rejected'), reason: z.string().min(1) }),
    z.object({ status: z.literal('new'), folder: connectFolderSchema, harnessHome: z.string().min(1) }),
  ]),
  'project',
  'write',
)

/**
 * Steps 3 and 4: the Harness check, then the draft Session in `root` (main inspects the folder
 * again). `workflowFolder` is the Workflow folder of Silent mode; null for the default one (a
 * multi-repo folder: the folder itself). Answers the draft with the problems bin/project-connect
 * --check finds in it (`draft`), the reason the Harness stops the connection (`harness`: the dialog
 * sends the user to the first-run screen), a refusal of the choice (`refused`), a Stop (`stopped`),
 * or what went wrong (`failed`). While it runs, projects.connect.activity tells the last action.
 */
export const projectsConnectDraft = invokeChannel(
  'projects.connect.draft',
  z.object({ draftId: z.string().min(1).max(100), root: z.string().min(1), mode: connectModeSchema, workflowFolder: z.string().min(1).nullable() }),
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('draft'), draft: profileDraftSchema, issues: z.array(draftIssueSchema) }),
    z.object({ status: z.literal('harness'), reason: z.string().min(1) }),
    z.object({ status: z.literal('refused'), reason: z.string().min(1) }),
    z.object({ status: z.literal('stopped') }),
    z.object({ status: z.literal('failed'), reason: z.string().min(1), issues: z.array(draftIssueSchema) }),
  ]),
  'project',
  'write',
)

/** "Stop" of the dialog: ends the draft Session `draftId`; false when none runs under it. */
export const projectsConnectStop = invokeChannel('projects.connect.stop', z.object({ draftId: z.string().min(1).max(100) }), z.object({ stopped: z.boolean() }), 'project', 'write')

/** Step 5: the problems of an edited draft (`bin/project-connect --check`); writes nothing. */
export const projectsConnectCheck = invokeChannel('projects.connect.check', z.object({ draft: profileDraftSchema }), z.object({ issues: z.array(draftIssueSchema) }), 'project', 'write')

/**
 * Step 6, "Connect": bin/project-connect writes the Profile and the gate registry entries, then the
 * folder is added to the list and becomes active (`added`; `notice` names a skipped qmd step). A
 * draft that fails the check writes nothing (`refused`); a folder the list does not take after the
 * write answers why (`rejected`).
 */
export const projectsConnectWrite = invokeChannel(
  'projects.connect.write',
  z.object({ root: z.string().min(1), draft: profileDraftSchema }),
  z.discriminatedUnion('status', [
    addedSchema,
    z.object({ status: z.literal('refused'), issues: z.array(draftIssueSchema) }),
    z.object({ status: z.literal('rejected'), reason: z.string().min(1) }),
  ]),
  'project',
  'write',
)

/** The last action of a draft Session, sent to the window that asked for the draft. */
export const projectsConnectActivity = eventChannel('projects.connect.activity', z.object({ draftId: z.string(), text: z.string() }), 'project', 'read')

// ── the GitHub account of a new Project (worfy-harness ticket 25) ─────────────────
//
// The form of "Add project" reads the accounts gh knows for the hosts of the folder's `origin`
// remotes and the write access of each account to every such repository
// (projects.connect.accounts, src/main/github/accounts.ts). The chosen account and the finish its
// access allows go into the draft (withGithubAccount) and are written with it on "Connect". A sign-in
// runs `gh auth login` in a terminal inside the dialog (projects.connect.signIn and the channels
// after it): the user answers gh there, worfy types nothing into it. The accounts are `project`, as
// the steps above; the sign-in is `local`, so a Linked machine never signs gh in here: on a Linked
// machine the step only reads the accounts (decided without the owner, to confirm).

export const workflowFinishSchema = z.enum(['pr-green-ci', 'local-green'])
export type WorkflowFinish = z.output<typeof workflowFinishSchema>

/** An account of `gh auth status --json hosts`, with its write access to the folder's repositories. */
export const githubAccountSchema = z.object({
  login: z.string().min(1),
  host: z.string().min(1),
  /** The account gh uses for its host now. */
  active: z.boolean(),
  /** gh's own word for the login: `success`, `error`, `timeout`. */
  state: z.string(),
  /** Write access to every repository with a GitHub origin. */
  push: z.boolean(),
  /** `pr-green-ci` with write access everywhere, else `local-green` (ADR-0045). */
  finish: workflowFinishSchema,
  /** Why the finish is local: the repositories without write access; null with access everywhere. */
  reason: z.string().nullable(),
})
export type GithubAccount = z.output<typeof githubAccountSchema>

/** A repository of the folder whose `origin` is on a GitHub host: `owner/repo`. */
export const githubRepoSchema = z.object({ name: z.string().min(1), host: z.string().min(1), slug: z.string().min(1) })

/**
 * The GitHub account step: the accounts of the hosts with their access and the one chosen by
 * default (`selected`: the active account with write access, else the first with it, else none);
 * no `origin` on a GitHub host (`no-origin`); no gh (`no-gh`); gh failing otherwise (`failed`).
 * Without accounts the Project has none (`github.account: null`) and the local finish.
 */
export const githubAccountsStepSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('accounts'),
    repos: z.array(githubRepoSchema),
    /** Repositories of a multi-repo folder without an origin on a GitHub host, by name. */
    skipped: z.array(z.string()),
    accounts: z.array(githubAccountSchema),
    selected: z.string().nullable(),
  }),
  z.object({ status: z.literal('no-origin'), reason: z.string().min(1) }),
  z.object({ status: z.literal('no-gh'), reason: z.string().min(1) }),
  z.object({ status: z.literal('failed'), reason: z.string().min(1) }),
])
export type GithubAccountsStep = z.output<typeof githubAccountsStepSchema>

/** What the account step puts into the draft. */
export interface GithubChoice {
  account: string | null
  finish: WorkflowFinish
}

/**
 * The choice for `login` (null: "No account"): the account and the finish its access allows. An
 * account the step does not list, "No account" and every step without accounts give no account
 * and the local finish: nobody checked the access then.
 */
export function githubChoice(step: GithubAccountsStep, login: string | null): GithubChoice {
  const account = step.status === 'accounts' && login !== null ? step.accounts.find((each) => each.login === login) : undefined
  return account === undefined ? { account: null, finish: 'local-green' } : { account: account.login, finish: account.finish }
}

const recordOf = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {})

/** The draft with `github.account` and `workflow.finish` of the choice; every other field as it was. */
export function withGithubAccount(draft: ProfileDraft, choice: GithubChoice): ProfileDraft {
  const profile = { ...draft.profile }
  profile.github = { ...recordOf(profile.github), account: choice.account }
  profile.workflow = { ...recordOf(profile.workflow), finish: choice.finish }
  return { ...draft, profile }
}

/** The account step of the folder `root` (main inspects it again); reads gh, writes nothing. */
export const projectsConnectAccounts = invokeChannel('projects.connect.accounts', z.object({ root: z.string().min(1) }), githubAccountsStepSchema, 'project', 'write')

const signInRef = { signInId: z.string().min(1).max(100) }
const signInCells = z.number().int().positive().max(10_000)

/**
 * "Sign in with gh": main runs `gh auth login` — the same gh worfy runs — in a pseudo-terminal of
 * its own, not in a Project's shell (there is no Project yet), and answers with the output so far.
 * Opening a running sign-in attaches to it. Its output and exit come on the events below.
 */
export const projectsConnectSignIn = invokeChannel(
  'projects.connect.signIn',
  z.object({ ...signInRef, cols: signInCells, rows: signInCells }),
  z.object({
    replay: z.string(),
    end: z.number().int().nonnegative(),
    /** The sizes of the pty `replay` came at, as `terminal.open` answers them (worfy-windows ticket 89). */
    sizes: z.array(replaySizeSchema).optional(),
    exited: z.object({ exitCode: z.number().int(), signal: z.number().int().nullable() }).nullable(),
  }).superRefine(sizesInOrder),
  'local',
)

/**
 * Keys the user typed into the sign-in terminal, or (`reply: true`) an answer of its xterm.js to gh.
 * main answers gh's requests whose answer does not depend on the view itself and drops a marked
 * answer to them, as on `terminal.input` (worfy-windows tickets 39 and 68).
 */
export const projectsConnectSignInInput = invokeChannel(
  'projects.connect.signInInput',
  z.object({ ...signInRef, data: z.string().min(1).max(100_000), reply: z.boolean().optional() }),
  z.void(),
  'local',
)

/** The size of the sign-in terminal's view. */
export const projectsConnectSignInResize = invokeChannel('projects.connect.signInResize', z.object({ ...signInRef, cols: signInCells, rows: signInCells }), z.void(), 'local')

/** Ends the sign-in (the dialog closed it); ending one that is not running is not an error. */
export const projectsConnectSignInClose = invokeChannel('projects.connect.signInClose', z.object(signInRef), z.void(), 'local')

export const projectsConnectSignInOutput = eventChannel('projects.connect.signInOutput', z.object({ ...signInRef, data: z.string(), end: z.number().int().nonnegative() }), 'local')

/** `gh auth login` ended: the step reads the accounts again. */
export const projectsConnectSignInExit = eventChannel(
  'projects.connect.signInExit',
  z.object({ ...signInRef, exitCode: z.number().int(), signal: z.number().int().nullable() }),
  'local',
)

declare module './channels' {
  interface IpcContract {
    'projects.pickFolder': typeof projectsPickFolder
    'projects.list': typeof projectsList
    'projects.browse': typeof projectsBrowse
    'projects.add': typeof projectsAdd
    'projects.select': typeof projectsSelect
    'projects.remove': typeof projectsRemove
    'projects.removal.preview': typeof projectsRemovalPreview
    'projects.removeProject': typeof projectsRemoveProject
    'projects.removal.reveal': typeof projectsRemovalReveal
    'projects.settings.get': typeof projectsSettingsGet
    'projects.settings.set': typeof projectsSettingsSet
    'projects.settings.defaults': typeof projectsSettingsDefaults
    'projects.hold': typeof projectsHold
    'projects.changed': typeof projectsChanged
    'projects.settings.changed': typeof projectsSettingsChanged
    'projects.reviewer.get': typeof projectsReviewerGet
    'projects.reviewer.build': typeof projectsReviewerBuild
    'projects.reviewer.delete': typeof projectsReviewerDelete
    'projects.reviewer.later': typeof projectsReviewerLater
    'projects.reviewer.remind': typeof projectsReviewerRemind
    'projects.reviewer.offer': typeof projectsReviewerOffer
    'projects.connect.inspect': typeof projectsConnectInspect
    'projects.connect.draft': typeof projectsConnectDraft
    'projects.connect.stop': typeof projectsConnectStop
    'projects.connect.check': typeof projectsConnectCheck
    'projects.connect.write': typeof projectsConnectWrite
    'projects.connect.activity': typeof projectsConnectActivity
    'projects.connect.accounts': typeof projectsConnectAccounts
    'projects.connect.signIn': typeof projectsConnectSignIn
    'projects.connect.signInInput': typeof projectsConnectSignInInput
    'projects.connect.signInResize': typeof projectsConnectSignInResize
    'projects.connect.signInClose': typeof projectsConnectSignInClose
    'projects.connect.signInOutput': typeof projectsConnectSignInOutput
    'projects.connect.signInExit': typeof projectsConnectSignInExit
  }
}
