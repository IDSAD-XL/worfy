// Spike for ticket worfy-mvp/06, question 4: the environment of an app started from Finder.
//
// Electron main entry of a separate throwaway app (own electron-builder config, own output
// folder). Built and started by ./run.sh; see its header. On start it records, then quits:
//   - PATH as the app got it from launchd, and where `node`, `pnpm`, `gh`, `git` resolve on it;
//   - PATH from the user's shell, once as a login shell (`$SHELL -lc env`) and once as an
//     interactive login shell (`$SHELL -ilc env`), and the same lookups on each;
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

// Same rule as scripts/spikes/sdk-probe.ts: never inherit a parent Claude Code session.
const INHERITED = /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PREVIEW_)|^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT)$/
const TOOLS = ['node', 'pnpm', 'gh', 'git']
const HOOK = 'echo "PATH=$PATH"; for c in node pnpm gh git; do echo "$c=$(command -v $c)"; done'
const START = '__worfy_env_start__'
const END = '__worfy_env_end__'

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

/** Environment of the user's shell; markers cut off whatever an interactive rc file prints. */
function shellEnv(flags: string): { command: string; env: Env; ms: number; error?: string } {
  const shell = process.env.SHELL || '/bin/zsh'
  const command = `${shell} ${flags} env`
  const t0 = Date.now()
  try {
    const text = execFileSync(shell, [flags, `echo ${START}; env; echo ${END}`], {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const body = text.slice(text.indexOf(START) + START.length, text.indexOf(END))
    const env: Env = {}
    for (const line of body.split('\n')) {
      const i = line.indexOf('=')
      if (i > 0) env[line.slice(0, i)] = line.slice(i + 1)
    }
    return { command, env, ms: Date.now() - t0 }
  } catch (err) {
    return { command, env: {}, ms: Date.now() - t0, error: String(err) }
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
    },
  }
  result.sdk_default_lookup = await sdkRun('SDK default binary lookup, app PATH', appEnv, dir)
  const explicit = { pathToClaudeCodeExecutable: unpacked }
  result.sdk_unpacked_app_path = await sdkRun('app.asar.unpacked binary, app PATH', appEnv, dir, explicit)
  result.sdk_unpacked_login_path = await sdkRun('app.asar.unpacked binary, -lc PATH', { ...appEnv, PATH: login.env.PATH }, dir, explicit)
  result.sdk_unpacked_interactive_path = await sdkRun(
    'app.asar.unpacked binary, -ilc PATH',
    { ...appEnv, PATH: interactive.env.PATH },
    dir,
    explicit,
  )
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
