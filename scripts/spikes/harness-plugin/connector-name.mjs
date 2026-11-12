// Spike for ticket worfy-mcp-live/11 (note: .scratch/worfy-mcp-live/spike-claudeai-connectors.md): how the
// policy tier of Claude Code (the SDK's `managedSettings`, the one worfy sends) matches a server whose name
// has a dot and a space — the shape of every claude.ai connector name, `claude.ai <display name>`.
//
// Run from the repository root of a worktree, with plain Node (no Electron needed, no model call):
//
//   node scripts/spikes/harness-plugin/connector-name.mjs
//
// Sandbox only: HOME and CLAUDE_CONFIG_DIR in a fresh temporary directory, fake `security` and `open` first
// on PATH (no Keychain, no browser), no login, and no message is ever sent, so no model is called. The
// servers are invented; the remote ones point at closed local ports, so every server ends `failed`: what
// counts is whether Claude Code lists a server at all (a server its policy cut is not listed).
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { query } from '@anthropic-ai/claude-agent-sdk'

/** The Claude Code binary of the SDK's platform package: the one worfy runs. */
function bundledClaude() {
  const sdkPackage = realpathSync(join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'))
  const platformPackage = createRequire(sdkPackage).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`)
  return join(dirname(platformPackage), 'claude')
}

const root = mkdtempSync(join(tmpdir(), 'worfy-connector-name-'))
const home = join(root, 'home')
const config = join(home, '.claude')
const bin = join(root, 'fake-bin')
const cwd = join(root, 'work')
for (const dir of [config, bin, cwd]) mkdirSync(dir, { recursive: true })
for (const name of ['security', 'open']) {
  // `security find-generic-password` answers 44, "item not found": an empty Keychain.
  writeFileSync(join(bin, name), '#!/bin/sh\n[ "$1" = find-generic-password ] && exit 44\nexit 1\n')
  chmodSync(join(bin, name), 0o755)
}

// One stdio and one remote server named like a claude.ai connector, and one of each with a plain name.
const servers = {
  'acme-widget': { type: 'stdio', command: '/usr/bin/true', args: [] },
  'claude.ai Acme Widget': { type: 'stdio', command: '/usr/bin/true', args: ['x'] },
  'claude.ai Acme Remote': { type: 'http', url: 'http://127.0.0.1:9/mcp' },
  'acme-remote': { type: 'http', url: 'http://127.0.0.1:10/mcp' },
}
writeFileSync(join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, mcpServers: servers }))

// Variables a parent Claude Code session leaves behind, and every credential variable: none reaches the child.
const INHERITED = /^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PREVIEW_)|^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_ENV_FILE|CLAUDE_CONFIG_DIR|GH_TOKEN|GITHUB_TOKEN)$/
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !INHERITED.test(key)))
Object.assign(env, { HOME: home, CLAUDE_CONFIG_DIR: config, PATH: `${bin}:${process.env.PATH ?? ''}`, DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' })
if (env.HOME === process.env.HOME || !env.CLAUDE_CONFIG_DIR.startsWith(root)) throw new Error('sandbox guard: the child would see the real HOME')

const byName = (serverName) => ({ serverName })
/** Each variant: the `managedSettings` of the query; undefined — none. */
const variants = {
  'no-policy': undefined,
  // What worfy sends today (options.ts): every name of the Profile's list as a serverName entry.
  'names-as-worfy-writes': { allowManagedMcpServersOnly: true, allowedMcpServers: Object.keys(servers).map(byName) },
  'only-dotted-name': { allowManagedMcpServersOnly: true, allowedMcpServers: [byName('claude.ai Acme Remote')] },
  // The way past the name check for a remote server: its URL.
  'name-plus-url': { allowManagedMcpServersOnly: true, allowedMcpServers: [byName('acme-widget'), { serverUrl: 'http://127.0.0.1:9/*' }] },
  // The cost of that way: with one serverUrl entry, a remote server is no longer matched by its name.
  'remote-name-beside-url': { allowManagedMcpServersOnly: true, allowedMcpServers: [byName('acme-remote'), { serverUrl: 'http://127.0.0.1:9/*' }] },
  // Turn off without a list (options.ts): the deny list compares names verbatim.
  'deny-dotted-name': { deniedMcpServers: [byName('claude.ai Acme Remote')] },
}

const claude = bundledClaude()
const out = {}
for (const [variant, managedSettings] of Object.entries(variants)) {
  const stderr = []
  let end
  const ended = new Promise((resolve) => (end = resolve))
  // An input that yields no message: no turn, no model call.
  const prompt = { [Symbol.asyncIterator]: () => ({ next: () => ended }) }
  const options = {
    cwd,
    env,
    settingSources: ['user', 'project', 'local'],
    pathToClaudeCodeExecutable: claude,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    stderr: (chunk) => stderr.push(chunk),
    ...(managedSettings === undefined ? {} : { managedSettings }),
  }
  const q = query({ prompt, options })
  let listed
  try {
    let list = await q.mcpServerStatus()
    for (let i = 0; i < 20 && list.some((server) => server.status === 'pending'); i++) {
      await sleep(500)
      list = await q.mcpServerStatus()
    }
    listed = list.map((server) => `${server.name} [${server.status}]`)
  } catch (error) {
    listed = { error: String(error).slice(0, 300) }
  }
  end({ done: true, value: undefined })
  q.close()
  const warnings = stderr.join('').split('\n').filter((line) => /allowedMcpServers|deniedMcpServers|invalid entr/i.test(line))
  out[variant] = { managedSettings: managedSettings ?? null, listed, warnings }
}
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
