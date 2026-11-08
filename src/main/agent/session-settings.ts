// The model, effort and permission mode the user picked for a Session Node (ticket 19), kept in
// worfy's own data folder (ADR 0005) rather than in the Layout: ADR-0010 keeps the Orchestrator
// Node's data to the SDK session id and the cost.
//
// One file per Project, `<Project data folder>/session-settings.json`, keyed by the Node id. The
// Node id, not the SDK session id: the picks belong to the Node the user sees, so they outlive a
// saved session that cannot be resumed (a new session starts under the same Node), and a pick made
// before Claude Code has reported its session id has a key already.
//
// Reads and writes go through src/main/storage/json-file.ts: the write is atomic, and a file that
// cannot be parsed is set aside and read as empty. A damaged field of one Node's picks falls back
// to its default and keeps the others (readSettings).
//
// Besides the picks, a Session has its launch (SessionLaunch, worfy-daily ticket 02): whether a
// person is at it. Autopilot (worfy-daily ticket 04) is the only caller that launches a Session
// unattended. Such a Session runs in bypassPermissions whatever mode its Node saved, and refuses a
// change of mode instead of applying it: in any other mode Claude Code would ask before a tool, and
// no one would answer. The launch is not written to session-settings.json: it belongs to one run,
// so a restart or the end of the run gives the Node back the user's own picks. A stopped run whose
// Session still has a turn or background tasks gives it back attended without a new process
// (Session.becomeAttended, worfy-autopilot-queue ticket 08): the launch of a live Session can change.
import { join } from 'node:path'
import { z } from 'zod'
import { EFFORT_LEVELS, readSettings, sessionSettingsSchema, type SessionSettings, type SettingsChange } from '../../shared/agent/settings'
import type { SessionKind } from '../../shared/ipc/sessions'
import { readJsonFile, writeJsonFile } from '../storage/json-file'
import type { LaunchApproval } from './auto-approve/run-approval'

export const SESSION_SETTINGS_FILE = 'session-settings.json'

/** How a Session is launched, besides the user's picks. */
export interface SessionLaunch {
  /** No person is at the Session: nothing it does may wait for an answer in the UI. */
  unattended: boolean
  /**
   * The Session is a Project's Orchestrator (src/main/agent/orchestrator.ts), attended or under
   * Autopilot: its Claude Code gets the Orchestrator's autocompact window (worfy-polish ticket 24).
   * Absent — any other Session.
   */
  orchestrator?: boolean
  /**
   * The SessionKind of the Session on a Session Node (worfy-product-session ticket 01), from the Node's
   * data on every start of it. Absent — a plain Session.
   */
  kind?: SessionKind
  /**
   * The approval policy of an unattended Session (worfy-auto-approve ticket 04): the mode and the
   * decisions of the Autopilot run that owns the Session, and the environment its agent starts with.
   * Absent: every permission request is refused, as before the ticket.
   */
  approval?: LaunchApproval
}

/** A Session the user started, or one they can answer: the default. */
export const ATTENDED: SessionLaunch = { unattended: false }

/** What a change of the permission mode of an unattended Session answers, over IPC. */
export const UNATTENDED_MODE_MESSAGE =
  'This Session runs unattended (Autopilot), so its permission mode stays bypassPermissions: in any other mode Claude Code would ask before a tool, and no one is there to answer.'

/** The model a Product Session runs on whatever was picked (the owner's answer Q10): the alias of the strongest one. */
export const PRODUCT_SESSION_MODEL = 'opus'
/** The effort a Product Session starts with: the highest level Claude Code takes. */
export const PRODUCT_SESSION_EFFORT: string = EFFORT_LEVELS[EFFORT_LEVELS.length - 1] ?? 'max'

/** What a change of the model of a Product Session answers, over IPC. */
export const PRODUCT_MODEL_MESSAGE = 'Product Session always runs on the strongest model (opus): its model cannot be changed.'

/**
 * The settings a Session runs with: an unattended one always in bypassPermissions; a Product Session
 * (worfy-product-session ticket 02) always on PRODUCT_SESSION_MODEL, starting at PRODUCT_SESSION_EFFORT,
 * whatever its Node saved — Eco mode, which sets only the models of the Profile's Subagent roles, never
 * reaches it.
 */
export function launchSettings(settings: SessionSettings, launch: SessionLaunch): SessionSettings {
  const product = launch.kind === 'product' ? { model: PRODUCT_SESSION_MODEL, effort: PRODUCT_SESSION_EFFORT } : {}
  return launch.unattended ? { ...settings, ...product, permissionMode: 'bypassPermissions' } : { ...settings, ...product }
}

/**
 * What a change of the permission setting of an unattended Session of another Vendor answers: the
 * setting it runs in, by that Vendor's own id (Codex: `full-access`, worfy-multi-vendor ticket 37).
 */
export const unattendedPresetMessage = (forced: string): string =>
  `This Session runs unattended (Autopilot), so its permission setting stays ${forced}: in any other setting the agent would ask before it acts, and no one is there to answer.`

/**
 * Why a settings change is refused for this launch, or null when it may be applied. A refused change
 * is refused whole. A Product Session refuses another model (PRODUCT_MODEL_MESSAGE). `forced`: the
 * permission setting the Vendor runs an unattended Session in, by its own id (SessionPart.settingsFor of
 * bypassPermissions); a pick of it, or of bypassPermissions, is no change. Claude Code's refusal names
 * bypassPermissions, another Vendor's its own setting.
 */
export function settingsChangeRefusal(launch: SessionLaunch, change: SettingsChange, forced = 'bypassPermissions'): string | null {
  if (launch.kind === 'product' && change.model !== undefined && change.model !== PRODUCT_SESSION_MODEL) return PRODUCT_MODEL_MESSAGE
  if (!launch.unattended || change.permissionMode === undefined || change.permissionMode === 'bypassPermissions' || change.permissionMode === forced) return null
  return forced === 'bypassPermissions' ? UNATTENDED_MODE_MESSAGE : unattendedPresetMessage(forced)
}

const nodeId = z.string().min(1)

/** The file as read: each Node's picks field by field, over the defaults. */
const readSchema = z.object({ nodes: z.record(nodeId, z.unknown().transform(readSettings)) })
/** The file as written: only whole, valid picks. */
const writeSchema = z.object({ nodes: z.record(nodeId, sessionSettingsSchema) })

export class SessionSettingsStore {
  /** `dirOf` gives a Project's data folder and throws for a Project that is not in the list. */
  constructor(private readonly dirOf: (projectId: string) => string) {}

  file(projectId: string): string {
    return join(this.dirOf(projectId), SESSION_SETTINGS_FILE)
  }

  /** The picks saved for a Node, or undefined when there are none. I/O errors other than a missing file throw. */
  read(projectId: string, nodeId: string): SessionSettings | undefined {
    return readJsonFile(this.file(projectId), readSchema)?.nodes[nodeId]
  }

  /** Saves the picks of one Node and keeps the other Nodes'. */
  write(projectId: string, nodeId: string, settings: SessionSettings): void {
    const file = this.file(projectId)
    const nodes = readJsonFile(file, readSchema)?.nodes ?? {}
    writeJsonFile(file, writeSchema, { nodes: { ...nodes, [nodeId]: settings } })
  }
}
