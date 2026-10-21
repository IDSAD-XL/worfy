// The environment the Harness scripts run with when the main process starts them.
//
// The scripts are Node scripts, and worfy runs them as `node <script>` with the node on the PATH
// of this environment (src/main/workflow/profile.ts, harnessScriptCommand). An app started
// from Finder has the PATH of launchd, /usr/bin:/bin:/usr/sbin:/sbin, and node is not on it
// (ADR-0007). So a script never gets worfy's own `process.env`: it gets the user's login shell
// environment, the one Sessions and Terminal Nodes get (src/main/agent/env.ts), captured once per
// app run and again when a reader asks for a fresh one (below). One exception: when the login
// shell failed the capture, the PATH of worfy's process goes after the system PATH (withProcessPath).
//
// HARNESS_HOME is not set here. Each runner looks for the Harness on every run and adds it for
// the plugin with `scriptEnv` (src/main/harness/locate.ts), so a machine that switches to the
// plugin is read without a restart. For the plugin, the Harness home worfy found wins over a
// HARNESS_HOME the user exports in the login shell; the old Harness in <claude home>/bin gets the
// login shell's HARNESS_HOME as it is.
//
// A variable set only on worfy's own process — CLAUDE_GATE_CONFIG, CLAUDE_PROFILES_DIR, a test's
// stub settings — does not reach the scripts any more. A sandbox for them is made with HOME: the
// login shell reads its rc files there and exports what they set (scripts/e3-sandbox.sh writes
// `.zshenv` and `.profile`), and WORFY_HARNESS_HOME names the Harness home.
//
// Every reader that starts a Harness script takes this as a required parameter with no default:
// a forgotten environment is then a compile error, not a Project that shows no Epics.
import { agentEnv, recaptureAgentEnv, type CapturedEnv } from '../agent/env'

/** The variables a Harness script starts with, before `scriptEnv` adds HARNESS_HOME. */
export type HarnessScriptEnv = Readonly<Record<string, string | undefined>>

/**
 * When the environment is to be taken from the login shell again instead of the one held
 * (worfy-harness ticket 37). `always`: the last call failed in a way that points at the
 * environment — its PATH has no node, or node could not run the script (exit code 127, 126).
 * `if-fallback`: it failed otherwise, a script that could not be started for another reason
 * included; the environment is taken again only when the held one is the minimal fallback,
 * because the shell failed the capture.
 */
export interface HarnessScriptEnvRequest {
  fresh?: 'always' | 'if-fallback'
}

/** Gives the environment on each run of a script; the app's source below answers from a cache. */
export type HarnessScriptEnvSource = (request?: HarnessScriptEnvRequest) => Promise<HarnessScriptEnv>

/**
 * The app's source: the login shell environment agentEnv() holds, with nothing of worfy's own
 * process merged in but the PATH after a failed capture; with `fresh`, captured again first (`recaptureAgentEnv`: one shell run shared
 * by every caller, and what new Sessions get afterwards). It never rejects: when the shell fails,
 * takes longer than its timeout, or SHELL is empty, the answer is the minimal environment with the
 * system PATH (src/main/agent/env.ts) and the PATH of worfy's process after it (withProcessPath), and
 * a script that needs node and finds none there fails as it does from Finder — the window shows why
 * (src/main/workflow/folder.ts, the First run row «Harness scripts»).
 */
export const harnessScriptEnv: HarnessScriptEnvSource = async (request = {}) => {
  if (request.fresh === 'always') return withProcessPath(await recaptureAgentEnv())
  const held = await agentEnv()
  if (request.fresh === 'if-fallback' && held.from === 'fallback') return withProcessPath(await recaptureAgentEnv())
  return withProcessPath(held)
}

/**
 * The environment a script gets from a capture. When the login shell failed the capture, the PATH
 * of worfy's own process goes after the system PATH (worfy-harness ticket 43): worfy started from a
 * terminal then still finds the node it was started with, as it did before the scripts took the
 * login shell's environment, and worfy started from Finder adds only launchd's PATH, which the
 * system PATH already holds. The system PATH stays first, so a tool there is not replaced. Only the
 * scripts get this: Sessions and Terminal Nodes keep the minimal environment ADR-0007 describes.
 * On Windows the fallback already holds the Path of worfy's process (src/main/agent/env.ts).
 */
export function withProcessPath(captured: CapturedEnv, processPath = process.env.PATH, platform: NodeJS.Platform = process.platform): HarnessScriptEnv {
  if (captured.from !== 'fallback' || platform === 'win32' || !processPath) return captured.env
  const entries = (captured.env.PATH ?? '').split(':').filter((entry) => entry !== '')
  for (const entry of processPath.split(':')) if (entry !== '' && !entries.includes(entry)) entries.push(entry)
  return { ...captured.env, PATH: entries.join(':') }
}

/** What `recaptureForCheckAgain` refreshes: the app's WorkflowHub (src/main/workflow/watch.ts). */
export interface FailedLayouts {
  retryFailedLayouts(): Promise<number>
}

/**
 * First run's "Check again" (src/main/ipc/first-run.ts), before its checks: the login shell is
 * captured again, then every Project of the sidebar whose layout failed asks it again at once with
 * that environment, instead of at its retry timer (up to 5 minutes later). Those asks are plain
 * requests: the shell has just run, so they start none of their own. The asks are not awaited —
 * the checks do not wait for the Epics to be read.
 */
export async function recaptureForCheckAgain(hub: FailedLayouts): Promise<void> {
  await recaptureAgentEnv()
  void hub.retryFailedLayouts()
}
