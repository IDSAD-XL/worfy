// The `harnessHooks` part of the Codex driver (src/main/vendors/harness-hooks.ts; worfy-multi-vendor
// ticket 39; ADR-0094, risk 3): whether Codex runs the hooks of the Harness now. Codex trusts a plugin's
// hooks by the hash of the whole plugin folder, so after every install or update of the Harness
// (src/main/harness/codex-install.ts) its hooks are off until the user approves them in Codex (`/hooks`).
// Without them the gate and the guards of the workflow do not hold in Codex, so Autopilot does not start
// a Run, nor a Wave of one, on a Codex Orchestrator until they are approved
// (Orchestrators.unattendedRefusal), and the toolbar's step "Approve the Harness hooks in Codex" asks
// the same (src/renderer/harness/CodexHooksStep.tsx, `harness.codexHooks`).
//
// The answer comes from Codex itself: `hooks/list` of a short-lived app-server (account.ts, withCodex),
// the hooks of the plugin worfy@worfy-harness with their `trustStatus`:
//   - approved: every hook the Harness's hooks.json declares on an event Codex knows is listed, and
//     every listed one is enabled and `trusted` (or `managed`, which Codex runs without an approval).
//     The declared hooks are read from that hooks.json itself — the copy Codex installed, at the
//     `sourcePath` Codex lists — so an install that brings new hooks needs them all;
//   - not approved: any hook of the Harness `untrusted`, `modified` or disabled;
//   - unknown, which never counts as approved: no app-server, an error, a timeout, an answer of a shape
//     or a trust status worfy does not know, no hook of the Harness listed (the Harness is not
//     installed in Codex), a declared hook Codex does not list, or an error Codex reports for a file of
//     the Harness's plugin folder.
// Warnings are not read: Codex warns of things that do not turn a hook off (a SessionEnd timeout it
// clamps to 3 s).
//
// It writes nothing: the app-server runs in worfy's own folder, as the account check's does; the only
// file it reads is the Harness's hooks.json in CODEX_HOME.
import { readFileSync } from 'node:fs'
import { dirname, sep } from 'node:path'
import type { HarnessHooksTrust } from '../../../shared/ipc/harness'
import type { HarnessHooksPart } from '../harness-hooks'
import { appCodexStarter, withCodex, type StartCodex } from './account'
import type { HookEventName } from './protocol/ts/v2/HookEventName'
import type { HookMetadata } from './protocol/ts/v2/HookMetadata'
import type { HooksListParams } from './protocol/ts/v2/HooksListParams'
import type { HooksListResponse } from './protocol/ts/v2/HooksListResponse'
import type { HookTrustStatus } from './protocol/ts/v2/HookTrustStatus'

/**
 * The id Codex lists the Harness's hooks under: the plugin `worfy` of the marketplace `worfy-harness`
 * (HARNESS_PLUGIN_ID of src/main/harness/install.ts; test/contract/codex-harness-hooks.test.ts holds the two
 * equal, so the driver does not import from the Harness installer).
 */
export const HARNESS_PLUGIN = 'worfy@worfy-harness'

/** What a Codex Run answers while the hooks of the Harness are not approved (or worfy cannot tell). */
export const CODEX_HOOKS_REFUSAL = 'The Harness hooks are not approved in Codex. Approve them in /hooks and start again.'

/** How long the check waits for the answer of `hooks/list`. */
export const HOOKS_TRUST_TIMEOUT_MS = 15_000

/** The events of a hooks.json the pinned Codex runs (HookEventName of the protocol); it skips any other. */
const CODEX_EVENTS: ReadonlySet<string> = new Set<HookEventName>([
  'preModelRequest',
  'postModelRequest',
  'preToolUse',
  'permissionRequest',
  'postToolUse',
  'preCompact',
  'postCompact',
  'sessionStart',
  'sessionEnd',
  'userPromptSubmit',
  'subagentStart',
  'subagentStop',
  'stop',
  'interrupt',
])

/**
 * The hooks the guarantees of the workflow rest on, when the Harness's hooks.json cannot be read: the
 * guard of Bash and file writes (PreToolUse) and the gate at the end of a turn (Stop, SubagentStop).
 */
export const REQUIRED_FALLBACK: Readonly<Record<string, number>> = { preToolUse: 1, stop: 1, subagentStop: 1 }

/** The trust statuses under which Codex runs a hook: approved by the user, or managed by a policy. */
const RUNS: ReadonlySet<HookTrustStatus> = new Set(['trusted', 'managed'])
/** The trust statuses under which Codex skips a hook until the user approves it in /hooks. */
const WAITS: ReadonlySet<HookTrustStatus> = new Set(['untrusted', 'modified'])

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

type ListedHook = Pick<HookMetadata, 'pluginId' | 'enabled' | 'trustStatus' | 'eventName' | 'sourcePath'>
interface Listed {
  hooks: ListedHook[]
  errors: string[]
}

/** The fields of a listed hook the check reads; null when one of them is not of the protocol's type. */
function hookOf(value: unknown): ListedHook | null {
  if (!isObject(value)) return null
  const { pluginId, enabled, trustStatus, eventName, sourcePath } = value
  if ((pluginId !== null && typeof pluginId !== 'string') || typeof enabled !== 'boolean' || typeof trustStatus !== 'string') return null
  if (typeof eventName !== 'string' || typeof sourcePath !== 'string') return null
  return { pluginId, enabled, trustStatus: trustStatus as HookTrustStatus, eventName: eventName as HookEventName, sourcePath }
}

/** Every hook of an answer of `hooks/list`, and the paths of its errors; null when the answer is not of the protocol's shape. */
function listed(answer: unknown): Listed | null {
  if (!isObject(answer) || !Array.isArray(answer.data)) return null
  const result: Listed = { hooks: [], errors: [] }
  for (const entry of answer.data as unknown[]) {
    if (!isObject(entry) || !Array.isArray(entry.hooks) || !Array.isArray(entry.errors)) return null
    for (const value of entry.hooks as unknown[]) {
      const hook = hookOf(value)
      if (hook === null) return null
      result.hooks.push(hook)
    }
    for (const error of entry.errors as unknown[]) {
      if (!isObject(error) || typeof error.path !== 'string') return null
      result.errors.push(error.path)
    }
  }
  return result
}

/**
 * How many command hooks a hooks.json declares on each event Codex runs, by Codex's camelCase name; null
 * when the file cannot be read or is not of that shape.
 */
export function declaredHooks(text: string): Record<string, number> | null {
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(file) || !isObject(file.hooks)) return null
  const counts: Record<string, number> = {}
  for (const [event, groups] of Object.entries(file.hooks)) {
    const name = `${event.charAt(0).toLowerCase()}${event.slice(1)}`
    if (!CODEX_EVENTS.has(name)) continue
    if (!Array.isArray(groups)) return null
    for (const group of groups as unknown[]) {
      if (!isObject(group) || !Array.isArray(group.hooks)) return null
      const commands = (group.hooks as unknown[]).filter((hook) => isObject(hook) && hook.type === 'command').length
      if (commands > 0) counts[name] = (counts[name] ?? 0) + commands
    }
  }
  return counts
}

/** Reads the hooks.json at `path`: what it declares, or null. */
function readDeclared(path: string): Record<string, number> | null {
  try {
    return declaredHooks(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Whether an answer of `hooks/list` (HooksListResponse) shows the hooks of the Harness approved.
 * `declaredAt` reads what the Harness's hooks.json declares, from the `sourcePath` Codex lists; when it
 * answers null the check needs REQUIRED_FALLBACK.
 */
export function harnessHooksTrustOf(answer: unknown, declaredAt: (path: string) => Record<string, number> | null = readDeclared): HarnessHooksTrust {
  const list = listed(answer)
  if (list === null) return 'unknown'
  const harness = list.hooks.filter((hook) => hook.pluginId === HARNESS_PLUGIN)
  if (harness.length === 0) return 'unknown'
  if (harness.some((hook) => !hook.enabled || WAITS.has(hook.trustStatus))) return 'not-approved'
  if (!harness.every((hook) => RUNS.has(hook.trustStatus))) return 'unknown'
  // An error Codex reports for a file of the Harness's plugin folder (its hooks.json, …): what it runs is not known.
  const roots = new Set(harness.map((hook) => dirname(dirname(hook.sourcePath))))
  if (list.errors.some((path) => [...roots].some((root) => path === root || path.startsWith(`${root}${sep}`) || path.startsWith(`${root}/`)))) return 'unknown'
  const sources = [...new Set(harness.map((hook) => hook.sourcePath))]
  const declared = sources.length === 1 ? (declaredAt(sources[0]!) ?? REQUIRED_FALLBACK) : REQUIRED_FALLBACK
  const counts = new Map<string, number>()
  for (const hook of harness) counts.set(hook.eventName, (counts.get(hook.eventName) ?? 0) + 1)
  return Object.entries(declared).every(([event, count]) => (counts.get(event) ?? 0) >= count) ? 'approved' : 'unknown'
}

export interface CodexHooksTrustOptions {
  /** Starts the app-server of the check; the app's (appCodexStarter) by default. */
  start?: StartCodex
  /** How long `hooks/list` may take; HOOKS_TRUST_TIMEOUT_MS by default. */
  timeoutMs?: number
}

/**
 * Asks Codex whether the hooks of the Harness are approved, for a Project at `cwd` (the app-server's own
 * folder when absent). Never throws: a check that fails is `unknown`.
 */
export async function readCodexHooksTrust(cwd: string | undefined, options: CodexHooksTrustOptions = {}): Promise<HarnessHooksTrust> {
  const params: HooksListParams = cwd === undefined ? {} : { cwds: [cwd] }
  try {
    const answer = await withCodex(options.start ?? appCodexStarter, undefined, (ask) => ask.request<HooksListResponse>('hooks/list', params, options.timeoutMs ?? HOOKS_TRUST_TIMEOUT_MS))
    return harnessHooksTrustOf(answer)
  } catch (error) {
    console.warn('[codex] could not read from Codex whether the Harness hooks are approved', error)
    return 'unknown'
  }
}

/** The `harnessHooks` part of a Codex driver whose checks start their app-server with `options.start`. */
export function codexHarnessHooksPart(options: CodexHooksTrustOptions = {}): HarnessHooksPart {
  return { trust: (cwd) => readCodexHooksTrust(cwd, options), refusal: CODEX_HOOKS_REFUSAL }
}

/** The app's part: each check starts the pinned Codex (or the fake under WORFY_CODEX=fake). */
export const codexHarnessHooks: HarnessHooksPart = codexHarnessHooksPart()
