// Whether Codex runs the hooks of the Harness now (worfy-multi-vendor ticket 39; ADR-0094, risk 3).
// Codex trusts a plugin's hooks by the hash of the whole plugin folder, so after every install or
// update of the Harness (codex-install.ts) its hooks are off until the user approves them in Codex
// (`/hooks`). Without them the gate and the guards of the workflow do not hold in Codex, so Autopilot
// does not start a Run on a Codex Orchestrator until they are approved (Orchestrators.unattendedRefusal,
// through the driver's `harnessHooks` part), and the toolbar shows the step "Approve the Harness hooks
// in Codex" after an install or update (src/renderer/harness/CodexHooksStep.tsx).
//
// The answer comes from Codex itself: `hooks/list` of a short-lived app-server (account.ts, withCodex),
// the hooks of the plugin worfy@worfy-harness with their `trustStatus`. Approved means every one of them
// is enabled and `trusted` (or `managed`, which Codex runs without an approval). Any of them `untrusted`,
// `modified` or disabled is not approved. Everything else — no app-server, an error, a timeout, an answer
// of a shape worfy does not know, a trust status it does not know, or no hook of the Harness listed at
// all (the Harness is not installed in Codex) — is `unknown`, which never counts as approved.
//
// It writes nothing: the app-server runs in worfy's own folder, as the account check's does.
import type { HarnessHooksTrust } from '../../shared/ipc/harness'
import type { HarnessHooksPart } from '../vendors/harness-hooks'
import { appCodexStarter, withCodex, type StartCodex } from '../vendors/codex/account'
import type { HookMetadata } from '../vendors/codex/protocol/ts/v2/HookMetadata'
import type { HooksListParams } from '../vendors/codex/protocol/ts/v2/HooksListParams'
import type { HooksListResponse } from '../vendors/codex/protocol/ts/v2/HooksListResponse'
import type { HookTrustStatus } from '../vendors/codex/protocol/ts/v2/HookTrustStatus'
import { HARNESS_PLUGIN_ID } from './install'

/** What a Codex Run answers while the hooks of the Harness are not approved (or worfy cannot tell). */
export const CODEX_HOOKS_REFUSAL = 'The Harness hooks are not approved in Codex. Approve them in /hooks and start again.'

/** How long the check waits for the answer of `hooks/list`. */
export const HOOKS_TRUST_TIMEOUT_MS = 15_000

/** The trust statuses under which Codex runs a hook: approved by the user, or managed by a policy. */
const RUNS: ReadonlySet<HookTrustStatus> = new Set(['trusted', 'managed'])
/** The trust statuses under which Codex skips a hook until the user approves it in /hooks. */
const WAITS: ReadonlySet<HookTrustStatus> = new Set(['untrusted', 'modified'])

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The fields of a listed hook the check reads; null when one of them is not of the protocol's type. */
function hookOf(value: unknown): Pick<HookMetadata, 'pluginId' | 'enabled' | 'trustStatus'> | null {
  if (!isObject(value)) return null
  const { pluginId, enabled, trustStatus } = value
  if ((pluginId !== null && typeof pluginId !== 'string') || typeof enabled !== 'boolean' || typeof trustStatus !== 'string') return null
  return { pluginId, enabled, trustStatus: trustStatus as HookTrustStatus }
}

/** Every hook of an answer of `hooks/list`; null when the answer is not of the protocol's shape. */
function listedHooks(answer: unknown): Pick<HookMetadata, 'pluginId' | 'enabled' | 'trustStatus'>[] | null {
  if (!isObject(answer) || !Array.isArray(answer.data)) return null
  const hooks: Pick<HookMetadata, 'pluginId' | 'enabled' | 'trustStatus'>[] = []
  for (const entry of answer.data as unknown[]) {
    if (!isObject(entry) || !Array.isArray(entry.hooks)) return null
    for (const value of entry.hooks as unknown[]) {
      const hook = hookOf(value)
      if (hook === null) return null
      hooks.push(hook)
    }
  }
  return hooks
}

/** Whether an answer of `hooks/list` (HooksListResponse) shows the hooks of the Harness approved. */
export function harnessHooksTrustOf(answer: unknown): HarnessHooksTrust {
  const hooks = listedHooks(answer)
  if (hooks === null) return 'unknown'
  const harness = hooks.filter((hook) => hook.pluginId === HARNESS_PLUGIN_ID)
  if (harness.length === 0) return 'unknown'
  if (harness.some((hook) => !hook.enabled || WAITS.has(hook.trustStatus))) return 'not-approved'
  return harness.every((hook) => RUNS.has(hook.trustStatus)) ? 'approved' : 'unknown'
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
    console.warn('[harness] could not read from Codex whether the Harness hooks are approved', error)
    return 'unknown'
  }
}

/** The `harnessHooks` part of a Codex driver whose checks start their app-server with `start`. */
export function codexHarnessHooksPart(options: CodexHooksTrustOptions = {}): HarnessHooksPart {
  return { trust: (cwd) => readCodexHooksTrust(cwd, options), refusal: CODEX_HOOKS_REFUSAL }
}

/** The app's part: each check starts the pinned Codex (or the fake under WORFY_CODEX=fake). */
export const codexHarnessHooks: HarnessHooksPart = codexHarnessHooksPart()
