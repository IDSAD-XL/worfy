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

/** Opens the system folder picker; null when the user cancels. */
export const projectsPickFolder = invokeChannel('projects.pickFolder', z.void(), z.object({ path: z.string().nullable() }), 'desktop')

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
  }
}
