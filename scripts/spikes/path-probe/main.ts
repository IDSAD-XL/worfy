// Spike for ticket worfy-mvp/06, question 4: the environment of an app started from Finder.
//
// Electron main entry of a separate throwaway app (own electron-builder config, own output
// folder). Built and started by ./run.sh; see its header. On start it records, then quits:
//   - PATH as the app got it from launchd, and where `node`, `pnpm`, `gh`, `git` resolve on it;
//   - PATH from the user's shell, once as a login shell (`$SHELL -lc env`) and once as an
//     interactive login shell (`$SHELL -ilc env`), and the same lookups on each. The shell starts
//     from a minimal environment (SHELL_BASE below), the way ADR-0007 prescribes, so variables
//     of whoever started the app never reach it; `env -0` keeps multi-line values intact;
//   - whether the Agent SDK starts its Claude Code binary from inside the package: first by its
//     own lookup, then by an explicit path into app.asar.unpacked;
//   - the PATH a command hook of that Claude Code sees, for each of the three PATHs (a
//     SessionStart hook passed through the SDK's flag settings, so nothing is written to
//     ~/.claude; settingSources is empty, so the user's own hooks do not run here).
// The result goes to <userData>/result.json (~/Library/Application Support/worfy-path-probe/).

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { app } from 'electron'

type Env = Record<string, string | undefined>

// Variables of a parent Claude Code session. The probe's own runs on the app's environment drop
// them (the app may be started from such a session); on the -ilc environment they only serve to
// show that none got there. This list is the probe's hygiene, not the rule for ticket 07.
const INHERITED = /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PREVIEW_)|^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT)$/
const TOOLS = ['node', 'pnpm', 'gh', 'git']
const HOOK = 'echo "PATH=$PATH"; for c in node pnpm gh git; do echo "$c=$(command -v $c)"; done'
const START = '__worfy_env_start__'
const END = '__worfy_env_end__'
// What the shell starts with: the variables launchd gives a Finder app that describe the user
// and the session, and the system PATH. Everything else comes from the user's rc files.
const SHELL_BASE = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'SSH_AUTH_SOCK', '__CF_USER_TEXT_ENCODING']
const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
// The only variables dropped from the shell's environment (spec, risk 3): with them Claude Code
// would log in by key instead of the user's subscription.
const API_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']

function lookup(path: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const tool of TOOLS) {
    try {
      out[tool] = execFileSync('/bin/sh', ['-c', `command -v ${tool}`], { env: { PATH: path ?? '' }, encoding: 'utf8' }).trim()
    } catch {
      out[tool] = '<not found>'
    }
  }
  return out
}

/**
 * Environment of the user's shell, started from SHELL_BASE only. `env -0` separates variables
 * with NUL, so a value with a newline stays one value; the markers, NUL-terminated as well, cut
 * off whatever an interactive rc file prints before or after.
 */
function shellEnv(flags: string): { command: string; env: Env; ms: number; dropped: string[]; error?: string } {
  const shell = process.env.SHELL || '/bin/zsh'
  const command = `env -i ${SHELL_BASE.join(' ')} PATH=${SYSTEM_PATH} ${shell} ${flags} 'env -0'`
  const base: Env = { PATH: SYSTEM_PATH }
  for (const k of SHELL_BASE) if (process.env[k] !== undefined) base[k] = process.env[k]
  const t0 = Date.now()
  try {
    const text = execFileSync(shell, [flags, `printf '%s\\0' ${START}; env -0; printf '%s\\0' ${END}`], {
      env: base,
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const parts = text.split('\0')
    const env: Env = {}
    for (const entry of parts.slice(parts.lastIndexOf(START) + 1, parts.lastIndexOf(END))) {
      const i = entry.indexOf('=')
      if (i > 0) env[entry.slice(0, i)] = entry.slice(i + 1)
    }
    const dropped = API_KEYS.filter((k) => k in env)
    for (const k of dropped) delete env[k]
    return { command, env, ms: Date.now() - t0, dropped }
  } catch (err) {
    return { command, env: {}, ms: Date.now() - t0, dropped: [], error: String(err) }
  }
}

function clean(env: Env): Env {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !INHERITED.test(k)))
}

async function sdkRun(label: string, env: Env, cwd: string, extra: Partial<Options> = {}): Promise<Record<string, unknown>> {
  const seen: string[] = []
  const out: Record<string, unknown> = { label }
  try {
    const q = query({
      prompt: 'Reply with the single word: ok',
      options: {
        cwd,
        env,
        model: 'haiku',
        tools: [],
        settingSources: [],
        strictMcpConfig: true,
        mcpServers: {},
        persistSession: false,
        maxTurns: 1,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settings: { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: HOOK }] }] } },
        stderr: (line: string) => {
          if (seen.length < 20) seen.push(line.slice(0, 300))
        },
        ...extra,
      },
    })
    for await (const m of q as AsyncIterable<SDKMessage>) {
      const r = m as unknown as Record<string, unknown>
      if (r.type === 'system' && r.subtype === 'init') out.claude_code_version = r.claude_code_version
      if (r.type === 'system' && r.subtype === 'hook_response') out.hook_stdout = String(r.stdout ?? '').trim().split('\n')
      if (r.type === 'result') out.result = { subtype: r.subtype, is_error: r.is_error, result: r.result }
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err)
  }
  out.stderr = seen
  return out
}

async function main(): Promise<void> {
  await app.whenReady()
  app.dock?.hide()
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  const login = shellEnv('-lc')
  const interactive = shellEnv('-ilc')
  const appEnv = clean(process.env as Env)
  // The SDK resolves its binary inside app.asar, where it cannot be spawned. electron-builder
  // unpacks executables on its own ("smart unpack"), so a runnable copy sits in app.asar.unpacked.
  const unpacked = join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    `claude-agent-sdk-${process.platform}-${process.arch}`,
    'claude',
  )
  const result: Record<string, unknown> = {
    when: new Date().toISOString(),
    packaged: app.isPackaged,
    electron: process.versions.electron,
    node: process.versions.node,
    cwd: process.cwd(),
    inherited_claude_vars: Object.keys(process.env).filter((k) => INHERITED.test(k)),
    app_path: process.env.PATH,
    app_lookup: lookup(process.env.PATH),
    login: { command: login.command, ms: login.ms, error: login.error, path: login.env.PATH, lookup: lookup(login.env.PATH) },
    interactive_login: {
      command: interactive.command,
      ms: interactive.ms,
      error: interactive.error,
      path: interactive.env.PATH,
      lookup: lookup(interactive.env.PATH),
      variables: Object.keys(interactive.env).length,
      // Expected empty: a parent Claude Code session's variables never reach the shell.
      parent_session_vars: Object.keys(interactive.env).filter((k) => INHERITED.test(k)),
      api_keys_dropped: interactive.dropped,
    },
  }
  result.sdk_default_lookup = await sdkRun('SDK default binary lookup, app PATH', appEnv, dir)
  const explicit = { pathToClaudeCodeExecutable: unpacked }
  result.sdk_unpacked_app_path = await sdkRun('app.asar.unpacked binary, app PATH', appEnv, dir, explicit)
  result.sdk_unpacked_login_path = await sdkRun('app.asar.unpacked binary, -lc PATH', { ...appEnv, PATH: login.env.PATH }, dir, explicit)
  // The whole -ilc environment, as ADR-0007 has ticket 07 pass it, not just its PATH.
  result.sdk_unpacked_interactive_env = await sdkRun('app.asar.unpacked binary, -ilc environment', interactive.env, dir, explicit)
  writeFileSync(join(dir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
}

main().then(
  () => app.exit(0),
  (err: unknown) => {
    try {
      const dir = app.getPath('userData')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'result.json'), `${JSON.stringify({ fatal: String(err) }, null, 2)}\n`)
    } finally {
      app.exit(1)
    }
  },
)
