// The environment the Harness scripts run with when the main process starts them.
//
// The scripts are `#!/usr/bin/env node` (`profile`, `ticket`) or need node themselves
// (`epic-status` without `--root` asks `ticket root`, and without node it exits 3). An app started
// from Finder has the PATH of launchd, /usr/bin:/bin:/usr/sbin:/sbin, and node is not on it
// (ADR-0007). So a script never gets worfy's own `process.env`: it gets the user's login shell
// environment, the one Sessions and Terminal Nodes get (src/main/agent/env.ts), captured once per
// app run and again when a reader asks for a fresh one (below).
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
import { agentEnv, recaptureAgentEnv } from '../agent/env'

/** The variables a Harness script starts with, before `scriptEnv` adds HARNESS_HOME. */
export type HarnessScriptEnv = Readonly<Record<string, string | undefined>>

/**
 * When the environment is to be taken from the login shell again instead of the one held
 * (worfy-harness ticket 37). `always`: the last call failed in a way that points at the
 * environment — the script found no node (exit code 127, 126) or could not be started.
 * `if-fallback`: it failed otherwise; the environment is taken again only when the held one is
 * the minimal fallback, because the shell failed the capture.
 */
export interface HarnessScriptEnvRequest {
  fresh?: 'always' | 'if-fallback'
}

/** Gives the environment on each run of a script; the app's source below answers from a cache. */
export type HarnessScriptEnvSource = (request?: HarnessScriptEnvRequest) => Promise<HarnessScriptEnv>

/**
 * The app's source: the login shell environment agentEnv() holds, with nothing of worfy's own
 * process merged in; with `fresh`, captured again first (`recaptureAgentEnv`: one shell run shared
 * by every caller, and what new Sessions get afterwards). It never rejects: when the shell fails,
 * takes longer than its timeout, or SHELL is empty, the answer is the minimal environment with the
 * system PATH (src/main/agent/env.ts), and a script that needs node then fails as it does from
 * Finder — the window shows why (src/main/workflow/folder.ts, the First run row «Harness scripts»).
 */
export const harnessScriptEnv: HarnessScriptEnvSource = async (request = {}) => {
  if (request.fresh === 'always') return (await recaptureAgentEnv()).env
  const held = await agentEnv()
  if (request.fresh === 'if-fallback' && held.from === 'fallback') return (await recaptureAgentEnv()).env
  return held.env
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
