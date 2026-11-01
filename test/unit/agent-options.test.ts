// sessionOptions for an ordinary Session and for one launched unattended (Autopilot, worfy-daily
// ticket 02): the permission mode Claude Code starts in, the flag that lets it skip permissions, and
// the canUseTool the Session hands over. And the MCP servers of a Session (worfy-daily ticket 06,
// ADR-0021): in a Project only those on the Profile's list, outside a Project the user's own set.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { draftSessionOptions, sessionHarnessPlugin, sessionOptions, userExtensions, withBrowserServer, type BrowserAttachment, type CanvasAttachment, type RuntimeInfo, type SessionOptionsInput } from '../../src/main/agent/options'
import * as bundled from '../../src/main/harness/bundled'
import type { CanUseToolHandler } from '../../src/main/agent/permissions'
import { DEFAULT_MCP_SERVERS, readSkillsAllowlist } from '../../src/main/workflow/profile'
import { PERMISSION_MODES, type SessionSettings } from '../../src/shared/agent/settings'
import { BROWSER_SERVER_NAME } from '../../src/shared/browser/tools'
import { CANVAS_SERVER_NAME } from '../../src/shared/canvas/tools'
import { removeTestTree } from '../remove'

/** The Harness copy of the build, as bundled.ts (worfy-harness ticket 04) would give it. */
const BUNDLED = '/Applications/worfy.app/Contents/Resources/harness'
vi.mock('../../src/main/harness/bundled', () => ({ bundledHarnessDir: vi.fn(() => '/Applications/worfy.app/Contents/Resources/harness') }))

const runtime: RuntimeInfo ={ packaged: false, resourcesPath: '/nowhere', platform: 'darwin', arch: 'arm64' }
const env = { PATH: '/usr/bin', HOME: '/Users/me' }
const canUseTool: CanUseToolHandler = () => Promise.resolve({ behavior: 'deny', message: 'no' })
const input = (more: Partial<SessionOptionsInput>): SessionOptionsInput => ({ cwd: '/repo', env, runtime, ...more })
const settings = (permissionMode: SessionSettings['permissionMode']): SessionSettings => ({ model: null, effort: null, permissionMode })

describe('sessionOptions of an ordinary Session', () => {
  it.each(PERMISSION_MODES)('starts in the mode the Session carries: %s', (mode) => {
    const options = sessionOptions(input({ settings: settings(mode), canUseTool }))
    expect(options.permissionMode).toBe(mode)
    expect(options.allowDangerouslySkipPermissions).toBe(true)
    expect(options.canUseTool).toBe(canUseTool)
  })

  it('is the same when `unattended` is false', () => {
    expect(sessionOptions(input({ settings: settings('plan'), unattended: false })).permissionMode).toBe('plan')
  })
})

describe('sessionOptions of an unattended Session', () => {
  it.each(PERMISSION_MODES)('starts in bypassPermissions whatever the settings carry: %s', (mode) => {
    const options = sessionOptions(input({ settings: settings(mode), canUseTool, unattended: true }))
    expect(options.permissionMode).toBe('bypassPermissions')
    expect(options.allowDangerouslySkipPermissions).toBe(true)
    // The Session's own handler, which refuses at once (permissions.ts, unattendedCanUseTool).
    expect(options.canUseTool).toBe(canUseTool)
  })

  it('keeps the model and effort it was given', () => {
    const options = sessionOptions(input({ settings: { model: 'opus', effort: 'low', permissionMode: 'default' }, unattended: true }))
    expect(options).toMatchObject({ model: 'opus', effort: 'low', permissionMode: 'bypassPermissions' })
  })

  it('starts in bypassPermissions without settings too', () => {
    expect(sessionOptions(input({ unattended: true })).permissionMode).toBe('bypassPermissions')
  })
})

// worfy-daily ticket 24: a new Session names its SDK session (`--session-id`), so its id is known
// before system/init. Claude Code 0.3.289 refuses --session-id with --resume unless --fork-session.
describe('the SDK session id of a Session', () => {
  const ID = 'f0000000-0000-4000-8000-000000000024'

  it('is passed as `sessionId` to a new Session', () => {
    const options = sessionOptions(input({ sessionId: ID }))
    expect(options.sessionId).toBe(ID)
    expect(options.resume).toBeUndefined()
  })

  it('is not passed with `resume`: the resumed session keeps its own', () => {
    const options = sessionOptions(input({ resume: 'f0000000-0000-4000-8000-000000000001', sessionId: ID }))
    expect(options.resume).toBe('f0000000-0000-4000-8000-000000000001')
    expect(options).not.toHaveProperty('sessionId')
    expect(options).not.toHaveProperty('forkSession')
    expect(options).not.toHaveProperty('continue')
  })

  it('is left to Claude Code when none is given', () => {
    expect(sessionOptions(input({}))).not.toHaveProperty('sessionId')
  })
})

const canvasServer = { type: 'sdk', name: CANVAS_SERVER_NAME } as unknown as McpServerConfig
const canvas: CanvasAttachment = { server: canvasServer, cardsDir: '/data/project/cards', instructions: 'Use the worfy-canvas tools.' }

describe('MCP servers of a Session in a Project', () => {
  it('with the list [qmd], allows only qmd: the user servers outside the list and worfy-canvas are left out', () => {
    const options = sessionOptions(input({ canvas, mcpAllowlist: ['qmd'] }))
    // The allowlist is the policy tier Claude Code applies to every server the user's settings bring
    // (user, project and local config, plugins, claude.ai connectors); only the Profile's names pass.
    expect(options.managedSettings).toEqual({ allowManagedMcpServersOnly: true, allowedMcpServers: [{ serverName: 'qmd' }] })
    // An SDK server is not covered by that policy, so worfy-canvas is only passed when it is listed.
    expect(options).not.toHaveProperty('mcpServers')
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' })
    // The user's CLAUDE.md, hooks and skills still come from their settings (ADR-0002).
    expect(options.settingSources).toEqual(['user', 'project', 'local'])
    expect(options).not.toHaveProperty('strictMcpConfig')
  })

  // worfy-harness ticket 17 (ADR-0048, item 4): the qmd of the Harness plugin, registered by worfy
  // under the name its tools carry; the user's own `qmd` from ~/.claude.json is no longer let in.
  it('with the default list, gets the plugin qmd and worfy-canvas with the canvas instructions, not the user qmd', () => {
    const options = sessionOptions(input({ canvas, mcpAllowlist: DEFAULT_MCP_SERVERS }))
    expect(options.managedSettings).toEqual({
      allowManagedMcpServersOnly: true,
      allowedMcpServers: [{ serverName: 'plugin_worfy_qmd' }, { serverName: CANVAS_SERVER_NAME }],
    })
    expect(options.mcpServers).toEqual({ [CANVAS_SERVER_NAME]: canvasServer })
    expect(options.additionalDirectories).toEqual([canvas.cardsDir])
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: canvas.instructions })
  })

  it('with an empty list, allows no MCP server at all', () => {
    const options = sessionOptions(input({ canvas, mcpAllowlist: [] }))
    expect(options.managedSettings).toEqual({ allowManagedMcpServersOnly: true, allowedMcpServers: [] })
    expect(options).not.toHaveProperty('mcpServers')
  })

  it('without a list, works as before: the user servers plus worfy-canvas', () => {
    const options = sessionOptions(input({ canvas }))
    expect(options).not.toHaveProperty('managedSettings')
    expect(options.mcpServers).toEqual({ [CANVAS_SERVER_NAME]: canvasServer })
  })
})

// worfy-browser ticket 04 (ADR-0021, ADR-0078 item 4): the Browser server goes through the same
// allowlist as worfy-canvas, and its instructions follow the canvas ones in the system prompt.
describe('the worfy-browser server of a Session in a Project', () => {
  const browserServer = { type: 'sdk', name: BROWSER_SERVER_NAME } as unknown as McpServerConfig
  const browser: BrowserAttachment = { server: browserServer, instructions: 'Use the worfy-browser tools.' }

  it('without a list (null) is there: nothing is filtered', () => {
    const options = sessionOptions(input({ canvas, browser, mcpAllowlist: null }))
    expect(options.mcpServers).toEqual({ [CANVAS_SERVER_NAME]: canvasServer, [BROWSER_SERVER_NAME]: browserServer })
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: `${canvas.instructions}\n${browser.instructions}` })
  })

  it('with an empty list is not there: every server is refused', () => {
    const options = sessionOptions(input({ canvas, browser, mcpAllowlist: [] }))
    expect(options).not.toHaveProperty('mcpServers')
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' })
  })

  it('is there when the list names it, alone or next to worfy-canvas', () => {
    expect(sessionOptions(input({ canvas, browser, mcpAllowlist: [BROWSER_SERVER_NAME] })).mcpServers).toEqual({ [BROWSER_SERVER_NAME]: browserServer })
    const both = sessionOptions(input({ canvas, browser, mcpAllowlist: ['qmd', CANVAS_SERVER_NAME, BROWSER_SERVER_NAME] }))
    expect(both.mcpServers).toEqual({ [CANVAS_SERVER_NAME]: canvasServer, [BROWSER_SERVER_NAME]: browserServer })
    expect(both.managedSettings?.allowedMcpServers).toContainEqual({ serverName: BROWSER_SERVER_NAME })
  })

  it('is not there when the list does not name it, worfy-canvas listed or not', () => {
    const canvasOnly = sessionOptions(input({ canvas, browser, mcpAllowlist: ['qmd', CANVAS_SERVER_NAME] }))
    expect(canvasOnly.mcpServers).toEqual({ [CANVAS_SERVER_NAME]: canvasServer })
    expect(canvasOnly.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: canvas.instructions })
    expect(sessionOptions(input({ canvas, browser, mcpAllowlist: ['qmd'] }))).not.toHaveProperty('mcpServers')
  })

  it('is never there without a Browser attachment (a Session outside a Project)', () => {
    expect(sessionOptions(input({ canvas: null, browser: null, mcpAllowlist: null }))).not.toHaveProperty('mcpServers')
  })
})

// The owner's decision 6 of worfy-browser ticket 04: the lists Profiles already have get
// worfy-browser without an edit, next to worfy-canvas.
describe('withBrowserServer', () => {
  it('adds worfy-browser to a list that names worfy-canvas, once', () => {
    expect(withBrowserServer(DEFAULT_MCP_SERVERS)).toEqual([...DEFAULT_MCP_SERVERS, BROWSER_SERVER_NAME])
    expect(withBrowserServer(['qmd', CANVAS_SERVER_NAME, BROWSER_SERVER_NAME])).toEqual(['qmd', CANVAS_SERVER_NAME, BROWSER_SERVER_NAME])
  })

  it('leaves a list without worfy-canvas as it is: the empty list allows nothing still', () => {
    expect(withBrowserServer([])).toEqual([])
    expect(withBrowserServer(['qmd', 'github'])).toEqual(['qmd', 'github'])
  })
})

describe('MCP servers of a Session outside a Project', () => {
  it('are the user servers as they are: no allowlist, no worfy-canvas', () => {
    const options = sessionOptions(input({ canvas: null, mcpAllowlist: null }))
    expect(options).not.toHaveProperty('managedSettings')
    expect(options).not.toHaveProperty('mcpServers')
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' })
  })
})

// worfy-throughput ticket 45: the draft Session of "Add project" may use only Read, Glob and Grep,
// so every MCP tool it was offered was refused by canUseTool and only filled its first request: the
// user's servers and the claude.ai connectors, about 900 tools on the owner's Mac.
describe('MCP servers of the draft Session of a Project connection', () => {
  const draft = (harnessPlugin: string | null) =>
    draftSessionOptions({
      cwd: '/repo',
      env,
      runtime,
      settings: settings('default'),
      canUseTool,
      outputFormat: { type: 'json_schema', schema: { type: 'object' } },
      allowedTools: ['Read', 'Glob', 'Grep'],
      disallowedTools: ['Bash'],
      harnessPlugin,
    })

  it('allows no MCP server: not the user servers, not the claude.ai connectors', () => {
    const options = draft(null)
    expect(options.managedSettings).toEqual({ allowManagedMcpServersOnly: true, allowedMcpServers: [], allowManagedPermissionRulesOnly: true })
    expect(options).not.toHaveProperty('mcpServers')
  })

  it('does not register the servers of the Harness plugin either', () => {
    const dir = mkdtempSync(join(tmpdir(), 'worfy-plugin-'))
    try {
      writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { qmd: { command: 'qmd-mcp' } } }))
      const options = draft(dir)
      expect(options.plugins).toEqual([{ type: 'local', path: dir, skipMcpDiscovery: true }])
      expect(options).not.toHaveProperty('mcpServers')
    } finally {
      removeTestTree(dir)
    }
  })
})

// worfy-harness ticket 12 (ADR-0040 item 2, ADR-0049): a Session carries worfy's own Harness inline
// unless the old Harness is on the machine. The path is that of bundled.ts (ticket 04), replaced
// here; the shape is the one the spike passed (scripts/spikes/harness-plugin/probe.ts), and the
// spike's system/init shows Claude Code taking it over the installed plugin of the same name.
describe('the Harness plugin of a Session', () => {
  it('passes the Harness folder it is given as the one local plugin, without its own MCP discovery', () => {
    const options = sessionOptions(input({ harnessPlugin: '/Applications/worfy.app/Contents/Resources/harness', warn: () => {} }))
    expect(options.plugins).toEqual([{ type: 'local', path: '/Applications/worfy.app/Contents/Resources/harness', skipMcpDiscovery: true }])
  })

  it('passes no plugins field without one', () => {
    expect(sessionOptions(input({}))).not.toHaveProperty('plugins')
    expect(sessionOptions(input({ harnessPlugin: null }))).not.toHaveProperty('plugins')
  })

  it('takes the folder from bundled.ts for the plugin and for no Harness, and none for the old Harness', () => {
    expect(bundled.bundledHarnessDir).not.toHaveBeenCalled()
    expect(sessionHarnessPlugin('plugin')).toBe(BUNDLED)
    expect(sessionHarnessPlugin('none')).toBe(BUNDLED)
    expect(bundled.bundledHarnessDir).toHaveBeenCalledTimes(2)
    expect(sessionHarnessPlugin('legacy')).toBeNull()
    expect(bundled.bundledHarnessDir).toHaveBeenCalledTimes(2)
  })

  it('end to end: the old Harness gives a Session without plugins, the plugin gives it the bundled copy', () => {
    expect(sessionOptions(input({ harnessPlugin: sessionHarnessPlugin('legacy') }))).not.toHaveProperty('plugins')
    expect(sessionOptions(input({ harnessPlugin: sessionHarnessPlugin('plugin'), warn: () => {} })).plugins).toEqual([
      { type: 'local', path: BUNDLED, skipMcpDiscovery: true },
    ])
  })

  it('matches what Claude Code reported for an inline plugin over an installed one (fixture of worfy-harness ticket 01)', () => {
    const fixture = join(import.meta.dirname, '..', 'fixtures', 'sdk-messages', 'plugin-known-inline-over-installed.jsonl')
    const init = readFileSync(fixture, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type?: string; subtype?: string; plugins?: { name: string; source: string; path: string }[] })
      .find((message) => message.type === 'system' && message.subtype === 'init')
    const worfy = (init?.plugins ?? []).filter((plugin) => plugin.name === 'worfy')
    // One plugin named worfy, the inline one: the installed copy of the same name is replaced.
    expect(worfy).toHaveLength(1)
    expect(worfy[0]).toMatchObject({ source: 'worfy@inline', path: '<tmp>/inline-known/worfy' })
  })
})

// worfy-harness ticket 17 (ADR-0048, item 4): with the plugin inline, Claude Code is told not to
// read its .mcp.json (`skipMcpDiscovery`), and worfy registers those servers itself as
// `plugin_worfy_<server>`, with ${CLAUDE_PLUGIN_ROOT} replaced by the inline folder. A server named
// that way is filtered by the allowlist like the user's own, and its tools keep the names they have
// in a terminal session (`mcp__plugin_worfy_qmd__…`).
describe('the MCP servers of the Harness plugin', () => {
  const plugin = (mcpJson: string | null): string => {
    const dir = mkdtempSync(join(tmpdir(), 'worfy-plugin-'))
    if (mcpJson !== null) writeFileSync(join(dir, '.mcp.json'), mcpJson)
    return dir
  }
  const dirs: string[] = []
  const made = (mcpJson: string | null): string => {
    const dir = plugin(mcpJson)
    dirs.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) removeTestTree(dir)
  })
  const QMD_JSON = JSON.stringify({
    mcpServers: {
      qmd: { command: '${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp', args: ['--root', '${CLAUDE_PLUGIN_ROOT}'], env: { WHERE: '${CLAUDE_PLUGIN_ROOT}/x' } },
    },
  })

  it('registers each server as plugin_worfy_<name> with the plugin path put in, next to worfy-canvas', () => {
    const dir = made(QMD_JSON)
    const warn = vi.fn()
    const options = sessionOptions(input({ canvas, mcpAllowlist: DEFAULT_MCP_SERVERS, harnessPlugin: dir, warn }))
    expect(options.plugins).toEqual([{ type: 'local', path: dir, skipMcpDiscovery: true }])
    expect(options.mcpServers).toEqual({
      [CANVAS_SERVER_NAME]: canvasServer,
      plugin_worfy_qmd: { type: 'stdio', command: `${dir}/bin/qmd-mcp`, args: ['--root', dir], env: { WHERE: `${dir}/x` } },
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('leaves out a server the allowlist does not name', () => {
    const dir = made(QMD_JSON)
    expect(sessionOptions(input({ canvas, mcpAllowlist: [CANVAS_SERVER_NAME], harnessPlugin: dir })).mcpServers).toEqual({
      [CANVAS_SERVER_NAME]: canvasServer,
    })
    expect(sessionOptions(input({ canvas, mcpAllowlist: ['qmd'], harnessPlugin: dir }))).not.toHaveProperty('mcpServers')
    expect(sessionOptions(input({ canvas, mcpAllowlist: [], harnessPlugin: dir }))).not.toHaveProperty('mcpServers')
  })

  it('registers them outside a Project too, where there is no allowlist', () => {
    const dir = made(QMD_JSON)
    const options = sessionOptions(input({ canvas: null, mcpAllowlist: null, harnessPlugin: dir }))
    expect(options).not.toHaveProperty('managedSettings')
    expect(Object.keys(options.mcpServers ?? {})).toEqual(['plugin_worfy_qmd'])
  })

  it.each([
    ['no .mcp.json', null],
    ['broken JSON', '{"mcpServers": {'],
    ['no mcpServers object', '{"qmd": 1}'],
  ])('%s: the Session starts without the plugin servers and says why', (_case, mcpJson) => {
    const dir = made(mcpJson)
    const warn = vi.fn()
    const options = sessionOptions(input({ canvas, mcpAllowlist: DEFAULT_MCP_SERVERS, harnessPlugin: dir, warn }))
    expect(options.plugins).toEqual([{ type: 'local', path: dir, skipMcpDiscovery: true }])
    expect(options.mcpServers).toEqual({ [CANVAS_SERVER_NAME]: canvasServer })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/\.mcp\.json/)
  })

  it('skips a server without a command and keeps the others', () => {
    const dir = made(JSON.stringify({ mcpServers: { broken: { args: [] }, qmd: { command: '${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp' } } }))
    const warn = vi.fn()
    const options = sessionOptions(input({ canvas: null, harnessPlugin: dir, warn }))
    expect(options.mcpServers).toEqual({ plugin_worfy_qmd: { type: 'stdio', command: `${dir}/bin/qmd-mcp` } })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/broken/)
  })

  it('gives the qmd server of this repository Harness the name the plugin tools carry in a terminal (fixture of ticket 01)', () => {
    const harness = join(import.meta.dirname, '..', '..', 'harness')
    const options = sessionOptions(input({ canvas: null, harnessPlugin: harness }))
    // .mcp.json says node ${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp; the root is substituted as text, so the tail keeps its "/".
    expect(options.mcpServers).toEqual({ plugin_worfy_qmd: { type: 'stdio', command: 'node', args: [`${harness}/bin/qmd-mcp`] } })
    const fixture = join(import.meta.dirname, '..', 'fixtures', 'sdk-messages', 'plugin-known-installed.jsonl')
    expect(readFileSync(fixture, 'utf8')).toContain('"mcp__plugin_worfy_qmd__')
  })
})

// worfy-throughput ticket 38 (ADR-0084): a Session in a Project whose Profile has `skills.allowed`
// gets, of the user's plugins and own skills, only those on the list. The list goes to Claude Code as
// flag settings (`--settings`): above the user's, the project's and the local settings, and below
// the policy tier, where `syncClaudeAiSkills: false` would move the synced skills to the trash.
// settingSources stay as they are, so CLAUDE.md and hooks still come from the user (ADR-0002).
describe('the plugins and skills of a Session in a Project', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) removeTestTree(dir)
  })
  const tmp = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'worfy-skills-'))
    dirs.push(dir)
    return dir
  }
  /** A Claude home and a project folder as the owner's Mac has them (the measurement of ticket 38). */
  const world = (): { home: string; cwd: string } => {
    const home = tmp()
    const cwd = tmp()
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ enabledPlugins: { 'figma@claude-plugins-official': true, 'mattpocock-skills@claude-plugins-official': true, 'worfy@worfy-harness': true, 'old@claude-plugins-official': false } }))
    for (const skill of ['wrangler', 'cloudflare']) {
      mkdirSync(join(home, 'skills', skill), { recursive: true })
      writeFileSync(join(home, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: d\n---\n`)
    }
    mkdirSync(join(home, 'skills', 'notes'), { recursive: true })
    mkdirSync(join(home, 'skills', 'synced', 'org_user', 'pdf'), { recursive: true })
    writeFileSync(join(home, 'skills', 'synced', 'org_user', 'pdf', 'SKILL.md'), '---\nname: pdf\n---\n')
    mkdirSync(join(cwd, '.claude'), { recursive: true })
    writeFileSync(join(cwd, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'team-tools@acme': true } }))
    writeFileSync(join(cwd, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'local-only@acme': true } }))
    return { home, cwd }
  }

  it('reads the plugins the settings enable and the skills of <claude home>/skills, and only reads', () => {
    const { home, cwd } = world()
    const tree = (dir: string): string[] => readdirSync(dir, { recursive: true, withFileTypes: true }).map((entry) => `${join(entry.parentPath, entry.name)}:${entry.isFile() ? readFileSync(join(entry.parentPath, entry.name), 'utf8') : 'dir'}`).sort()
    const before = { home: tree(home), cwd: tree(cwd) }
    const extensions = userExtensions(home, cwd)
    expect([...extensions.plugins].sort()).toEqual(['figma@claude-plugins-official', 'local-only@acme', 'mattpocock-skills@claude-plugins-official', 'team-tools@acme', 'worfy@worfy-harness'])
    // A folder without SKILL.md is no skill; the skills synced from claude.ai go by the `claude.ai` entry.
    expect([...extensions.skills].sort()).toEqual(['cloudflare', 'wrangler'])
    sessionOptions(input({ cwd, skillsAllowlist: ['figma'], userExtensions: extensions }))
    expect({ home: tree(home), cwd: tree(cwd) }).toEqual(before)
  })

  it('reads nothing from a Claude home without settings or skills, and from settings that are not JSON', () => {
    const home = tmp()
    const cwd = tmp()
    expect(userExtensions(home, cwd)).toEqual({ plugins: [], skills: [] })
    writeFileSync(join(home, 'settings.json'), '{ not json')
    expect(userExtensions(home, cwd)).toEqual({ plugins: [], skills: [] })
  })

  it('with a list, turns off every plugin and skill of the user outside it, worfy kept', () => {
    const { home, cwd } = world()
    const options = sessionOptions(input({ cwd, skillsAllowlist: ['figma', 'cloudflare'], userExtensions: userExtensions(home, cwd) }))
    expect(options.settings).toEqual({
      enabledPlugins: { 'mattpocock-skills@claude-plugins-official': false, 'team-tools@acme': false, 'local-only@acme': false },
      skillOverrides: { wrangler: 'off' },
      syncClaudeAiSkills: false,
      syncClaudeAiPlugins: false,
    })
    // CLAUDE.md and hooks still come from the user (ADR-0002); nothing of this is in the policy tier.
    expect(options.settingSources).toEqual(['user', 'project', 'local'])
    expect(options).not.toHaveProperty('managedSettings')
  })

  it('with an empty list, keeps only worfy, and names a plugin by its id too', () => {
    const { home, cwd } = world()
    const extensions = userExtensions(home, cwd)
    const none = sessionOptions(input({ cwd, skillsAllowlist: [], userExtensions: extensions })).settings as Record<string, Record<string, unknown>>
    expect(Object.keys(none.enabledPlugins ?? {}).sort()).toEqual(['figma@claude-plugins-official', 'local-only@acme', 'mattpocock-skills@claude-plugins-official', 'team-tools@acme'])
    expect(none.skillOverrides).toEqual({ cloudflare: 'off', wrangler: 'off' })
    const byId = sessionOptions(input({ cwd, skillsAllowlist: ['team-tools@acme'], userExtensions: extensions })).settings as Record<string, Record<string, unknown>>
    expect(byId.enabledPlugins).not.toHaveProperty('team-tools@acme')
  })

  it('keeps the skills and plugins synced from claude.ai when the list names claude.ai', () => {
    const { home, cwd } = world()
    const options = sessionOptions(input({ cwd, skillsAllowlist: ['claude.ai'], userExtensions: userExtensions(home, cwd) }))
    expect(options.settings).not.toHaveProperty('syncClaudeAiSkills')
    expect(options.settings).not.toHaveProperty('syncClaudeAiPlugins')
  })

  it('goes next to the autocompact window in the same flag settings', () => {
    const { home, cwd } = world()
    const options = sessionOptions(input({ cwd, skillsAllowlist: ['figma', 'mattpocock-skills', 'claude.ai', 'wrangler', 'cloudflare', 'team-tools', 'local-only'], userExtensions: userExtensions(home, cwd), autoCompactWindow: 200_000 }))
    expect(options.settings).toEqual({ autoCompactWindow: 200_000 })
  })

  it('never puts the synced-skills switch into the policy tier, where it would move them to the trash', () => {
    const { home, cwd } = world()
    const options = sessionOptions(input({ cwd, skillsAllowlist: [], userExtensions: userExtensions(home, cwd), mcpAllowlist: ['qmd'], permissionRulesFromPolicyOnly: true }))
    expect(Object.keys(options.managedSettings ?? {}).sort()).toEqual(['allowManagedMcpServersOnly', 'allowManagedPermissionRulesOnly', 'allowedMcpServers'])
    expect(options.settings).toMatchObject({ syncClaudeAiSkills: false, syncClaudeAiPlugins: false })
  })

  it('without a list (a Profile without the field, or a Session outside a Project) works as before', () => {
    const { home, cwd } = world()
    const extensions = userExtensions(home, cwd)
    expect(sessionOptions(input({ cwd, skillsAllowlist: null, userExtensions: extensions }))).not.toHaveProperty('settings')
    expect(sessionOptions(input({ cwd, userExtensions: extensions }))).not.toHaveProperty('settings')
    expect(sessionOptions(input({ cwd }))).not.toHaveProperty('settings')
    expect(sessionOptions(input({ cwd, skillsAllowlist: null, userExtensions: extensions, autoCompactWindow: 100_000 })).settings).toEqual({ autoCompactWindow: 100_000 })
  })

  it('turns off by the ids Claude Code reports in system/init, never a built-in or the inline plugin (fixture of worfy-harness ticket 01)', () => {
    const fixture = join(import.meta.dirname, '..', 'fixtures', 'sdk-messages', 'plugin-known-user-settings.jsonl')
    const init = readFileSync(fixture, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type?: string; subtype?: string; plugins?: { name: string; source: string }[] })
      .find((message) => message.type === 'system' && message.subtype === 'init')
    const reported = (init?.plugins ?? []).map((plugin) => plugin.source)
    // The settings enable the marketplace plugins of that run; the built-in, inline and synced ones come from elsewhere.
    const enabled = reported.filter((source) => !/@(builtin|inline|synced)$/u.test(source))
    expect(enabled).toEqual(['plugin-1@claude-plugins-official', 'plugin-2@claude-plugins-official'])
    const home = tmp()
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ enabledPlugins: Object.fromEntries(enabled.map((id) => [id, true])) }))
    const off = sessionOptions(input({ skillsAllowlist: ['plugin-2'], userExtensions: userExtensions(home, tmp()) })).settings as Record<string, Record<string, unknown>>
    expect(off.enabledPlugins).toEqual({ 'plugin-1@claude-plugins-official': false })
    for (const source of reported.filter((id) => /@(builtin|inline)$/u.test(id))) expect(off.enabledPlugins).not.toHaveProperty(source)
  })
})

describe("the Profile's skills.allowed", () => {
  const read = (code: number, stdout: string) => readSkillsAllowlist({ root: '/repo', claudeHome: '/nowhere', env: {}, run: () => Promise.resolve({ code, stdout, stderr: '' }), log: () => undefined })

  it('is the list the Profile names, each name once', async () => {
    expect(await read(0, '["figma", "claude.ai", "figma"]\n')).toEqual({ names: ['figma', 'claude.ai'], reason: null })
    expect(await read(0, '[]\n')).toEqual({ names: [], reason: null })
  })

  it('is no list — everything as before — without the field, outside a Project, or with a value of the wrong shape', async () => {
    expect((await read(4, '')).names).toBeNull()
    expect((await read(3, '')).names).toBeNull()
    expect((await read(0, 'null\n')).names).toBeNull()
    expect((await read(0, '"figma"\n')).names).toBeNull()
    expect((await read(0, '[1]\n')).names).toBeNull()
    expect((await read(0, '{ nope\n')).names).toBeNull()
  })
})
