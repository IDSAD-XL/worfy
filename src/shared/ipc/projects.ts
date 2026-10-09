// The `projects` domain: the list of Projects, the active one, and each Project's settings.
// Handled in src/main/ipc/projects.ts (ADR-0006).
import { z } from 'zod'
import { projectSettingsSchema } from '../projects/action-templates'
import { eventChannel, invokeChannel } from './channels'

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

export const projectsList = invokeChannel('projects.list', z.void(), projectsStateSchema, 'project')

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
)

export const projectsSelect = invokeChannel('projects.select', projectId, projectsStateSchema, 'local')

/** Removes the Project from the list; its data folder stays. */
export const projectsRemove = invokeChannel('projects.remove', projectId, projectsStateSchema, 'project')

export const projectsSettingsGet = invokeChannel('projects.settings.get', projectId, projectSettingsSchema, 'project')

/** Saves the settings; a template with an unknown placeholder fails the input schema. */
export const projectsSettingsSet = invokeChannel(
  'projects.settings.set',
  z.object({ id: z.string().min(1), settings: projectSettingsSchema }),
  projectSettingsSchema,
  'project',
)

/**
 * The default settings for the Harness found on the machine now (worfy-harness ticket 12): what
 * "Reset to default" puts into the fields. Main looks for the Harness on every call.
 */
export const projectsSettingsDefaults = invokeChannel('projects.settings.defaults', z.void(), projectSettingsSchema, 'project')

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
)

/** Sent to every window after a Project's settings were saved, so the action buttons (ticket 23) follow at once. */
export const projectsSettingsChanged = eventChannel('projects.settings.changed', z.object({ id: z.string().min(1), settings: projectSettingsSchema }), 'project')

/** Sent to every window after any change of the list or of the active Project. */
export const projectsChanged = eventChannel('projects.changed', projectsStateSchema, 'project')

// ── connecting a Project (worfy-harness ticket 24) ─────────────────────────────
//
// "Add project" is one dialog in steps: the folder (projects.connect.inspect), the mode and the
// Workflow folder, the Harness check and the draft Session (projects.connect.draft), the form
// (projects.connect.check) and the write through the Harness's bin/project-connect
// (projects.connect.write). Nothing is written before the last step. All of them are `local`: a
// Linked machine adds Projects with projects.add, never connects one.

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
  'local',
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
  'local',
)

/** "Stop" of the dialog: ends the draft Session `draftId`; false when none runs under it. */
export const projectsConnectStop = invokeChannel('projects.connect.stop', z.object({ draftId: z.string().min(1).max(100) }), z.object({ stopped: z.boolean() }), 'local')

/** Step 5: the problems of an edited draft (`bin/project-connect --check`); writes nothing. */
export const projectsConnectCheck = invokeChannel('projects.connect.check', z.object({ draft: profileDraftSchema }), z.object({ issues: z.array(draftIssueSchema) }), 'local')

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
  'local',
)

/** The last action of a draft Session, sent to the window that asked for the draft. */
export const projectsConnectActivity = eventChannel('projects.connect.activity', z.object({ draftId: z.string(), text: z.string() }), 'local')

declare module './channels' {
  interface IpcContract {
    'projects.pickFolder': typeof projectsPickFolder
    'projects.list': typeof projectsList
    'projects.add': typeof projectsAdd
    'projects.select': typeof projectsSelect
    'projects.remove': typeof projectsRemove
    'projects.settings.get': typeof projectsSettingsGet
    'projects.settings.set': typeof projectsSettingsSet
    'projects.settings.defaults': typeof projectsSettingsDefaults
    'projects.hold': typeof projectsHold
    'projects.changed': typeof projectsChanged
    'projects.settings.changed': typeof projectsSettingsChanged
    'projects.connect.inspect': typeof projectsConnectInspect
    'projects.connect.draft': typeof projectsConnectDraft
    'projects.connect.stop': typeof projectsConnectStop
    'projects.connect.check': typeof projectsConnectCheck
    'projects.connect.write': typeof projectsConnectWrite
    'projects.connect.activity': typeof projectsConnectActivity
  }
}
