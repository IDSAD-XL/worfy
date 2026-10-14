// The environment the Harness scripts run with when the main process starts them.
//
// The scripts are `#!/usr/bin/env node` (`profile`, `ticket`) or call node themselves
// (`epic-status` asks `ticket root` only when it finds node). An app started from Finder has the
// PATH of launchd, /usr/bin:/bin:/usr/sbin:/sbin, and node is not on it (ADR-0007). So a script
// never gets worfy's own `process.env`: it gets the user's login shell environment, the one
// Sessions and Terminal Nodes get (src/main/agent/env.ts), captured once per app run.
//
// HARNESS_HOME is not set here. Each runner looks for the Harness on every run and adds it for
// the plugin with `scriptEnv` (src/main/harness/locate.ts), so a machine that switches to the
// plugin is read without a restart. The Harness home worfy found wins over a HARNESS_HOME the user
// exports in the login shell.
//
// A variable set only on worfy's own process — CLAUDE_GATE_CONFIG, CLAUDE_PROFILES_DIR, a test's
// stub settings — does not reach the scripts any more. A sandbox for them is made with HOME: the
// login shell reads its rc files there and exports what they set (scripts/e3-sandbox.sh writes
// `.zshenv` and `.profile`), and WORFY_HARNESS_HOME names the Harness home.
//
// Every reader that starts a Harness script takes this as a required parameter with no default:
// a forgotten environment is then a compile error, not a Project that shows no Epics.
import { agentEnv } from '../agent/env'

/** The variables a Harness script starts with, before `scriptEnv` adds HARNESS_HOME. */
export type HarnessScriptEnv = Readonly<Record<string, string | undefined>>

/** Gives the environment on each run of a script; the app's source below answers from a cache. */
export type HarnessScriptEnvSource = () => Promise<HarnessScriptEnv>

/**
 * The app's source: the login shell environment of this app run, the object agentEnv() holds, with
 * nothing of worfy's own process merged in. It never rejects: when the shell fails, takes longer
 * than its timeout, or SHELL is empty, the answer is the minimal environment with the system PATH
 * (src/main/agent/env.ts), and a script that needs node then fails as it does from Finder — the
 * window shows why (src/main/workflow/folder.ts, the First run row «Harness scripts»).
 */
export const harnessScriptEnv: HarnessScriptEnvSource = async () => (await agentEnv()).env
