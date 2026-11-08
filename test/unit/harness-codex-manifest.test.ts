// worfy-polish ticket 55: Codex 0.166.0 fills in no ${CLAUDE_PLUGIN_ROOT} in a plugin's MCP servers,
// so the install into Codex writes the Harness copy a Codex manifest whose servers name their files by
// the copy's full path (codexPluginManifest, src/main/harness/codex-install.ts). The install itself
// is test/contract/harness-codex-install.test.ts.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexPluginManifest } from '../../src/main/harness/codex-install'

const HARNESS = join(__dirname, '..', '..', 'harness')
const claudeManifest = { name: 'worfy', version: '0.3.0+bbbbbbb', dependencies: ['example-skills@claude-plugins-official'] }
const mcp = JSON.parse(readFileSync(join(HARNESS, '.mcp.json'), 'utf8')) as unknown

describe('codexPluginManifest', () => {
  it("is Claude Code's manifest with the servers of harness/.mcp.json, the plugin root filled in", () => {
    expect(codexPluginManifest(claudeManifest, mcp, '/Users/me/.claude/worfy-harness/plugin', 'darwin')).toEqual({
      ...claudeManifest,
      mcpServers: { qmd: { command: 'node', args: ['/Users/me/.claude/worfy-harness/plugin/bin/qmd-mcp'] } },
    })
  })

  it('on Windows the path has backslashes after a drive letter, and a folder with spaces stays one argument', () => {
    const dir = 'C:\\Users\\me\\.claude\\worfy-harness\\plugin'
    expect(codexPluginManifest(claudeManifest, mcp, dir, 'win32').mcpServers).toEqual({ qmd: { command: 'node', args: ['C:\\Users\\me\\.claude\\worfy-harness\\plugin\\bin\\qmd-mcp'] } })
    const spaced = 'C:\\Users\\Jane Doe\\.claude\\worfy-harness\\plugin'
    expect(codexPluginManifest(claudeManifest, mcp, spaced, 'win32').mcpServers).toEqual({ qmd: { command: 'node', args: ['C:\\Users\\Jane Doe\\.claude\\worfy-harness\\plugin\\bin\\qmd-mcp'] } })
  })

  it('fills the variable in args, env and cwd, inside a string too, and leaves other strings and values alone', () => {
    const servers = { mcpServers: { s: { command: '${CLAUDE_PLUGIN_ROOT}/bin/s', args: ['--root=${CLAUDE_PLUGIN_ROOT}', '-v'], env: { DATA: '${CLAUDE_PLUGIN_ROOT}/data', N: 1 }, cwd: '${CLAUDE_PLUGIN_ROOT}' } } }
    expect(codexPluginManifest({ name: 'p' }, servers, '/opt/plugin', 'linux').mcpServers).toEqual({
      s: { command: '/opt/plugin/bin/s', args: ['--root=/opt/plugin', '-v'], env: { DATA: '/opt/plugin/data', N: 1 }, cwd: '/opt/plugin' },
    })
  })

  it('without .mcp.json or its mcpServers the manifest is the same as Claude Code’s', () => {
    expect(codexPluginManifest(claudeManifest, null, '/opt/plugin', 'darwin')).toEqual(claudeManifest)
    expect(codexPluginManifest(claudeManifest, { other: 1 }, '/opt/plugin', 'darwin')).toEqual(claudeManifest)
  })
})
