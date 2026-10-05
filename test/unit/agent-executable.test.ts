// Which Claude Code binary a Session runs (ADR-0008) and the options it runs with.
import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { claudeExecutablePath, sessionOptions, type RuntimeInfo } from '../../src/main/agent/options'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const resources = '/Applications/worfy.app/Contents/Resources'
const packaged: RuntimeInfo = { packaged: true, resourcesPath: resources, platform: 'darwin', arch: 'arm64' }
const dev: RuntimeInfo = { ...packaged, packaged: false, resourcesPath: '/repo/node_modules/electron/dist/Electron.app/Contents/Resources' }

describe('claudeExecutablePath', () => {
  it('lets the SDK find the binary itself in pnpm dev', () => {
    expect(claudeExecutablePath(dev)).toBeUndefined()
  })

  it('points into app.asar.unpacked, at the native binary of the platform package, in the packaged app', () => {
    expect(claudeExecutablePath(packaged)).toBe(`${resources}/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`)
    expect(claudeExecutablePath({ ...packaged, arch: 'x64' })).toBe(`${resources}/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64/claude`)
  })

  it('never points at cli.js or inside app.asar itself', () => {
    const path = claudeExecutablePath(packaged) ?? ''
    expect(path).not.toMatch(/cli\.js$/)
    expect(path).not.toMatch(/app\.asar\//)
  })

  it('names the platform package the SDK depends on, and it holds the claude binary', () => {
    // pnpm keeps the platform package next to the SDK, not at the top of node_modules;
    // electron-builder hoists it into the app's node_modules, where the packaged path points.
    const sdkDir = realpathSync(join(repoRoot, 'node_modules', '@anthropic-ai', 'claude-agent-sdk'))
    const platformPackage = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`
    const path = claudeExecutablePath({ packaged: true, resourcesPath: '/R', platform: process.platform, arch: process.arch })
    expect(path).toBe(`/R/app.asar.unpacked/node_modules/${platformPackage}/claude`)
    expect(existsSync(join(dirname(dirname(sdkDir)), platformPackage, 'claude'))).toBe(true)
  })
})

describe('sessionOptions', () => {
  const env = { PATH: '/usr/bin', HOME: '/Users/me' }

  it("runs with the user's settings, the claude_code preset and bypassPermissions", () => {
    const options = sessionOptions({ cwd: '/repo', env, runtime: dev })
    expect(options).toMatchObject({
      cwd: '/repo',
      env,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      includeHookEvents: true,
    })
    // No `append`: additions to the system prompt come with ticket 24.
    expect(options.systemPrompt).toStrictEqual({ type: 'preset', preset: 'claude_code' })
  })

  it('does not set a JavaScript runtime: the native binary needs no node', () => {
    expect(sessionOptions({ cwd: '/repo', env, runtime: packaged })).not.toHaveProperty('executable')
    expect(sessionOptions({ cwd: '/repo', env, runtime: dev })).not.toHaveProperty('executable')
  })

  it('sets the binary path only in the packaged app', () => {
    expect(sessionOptions({ cwd: '/repo', env, runtime: packaged }).pathToClaudeCodeExecutable).toBe(claudeExecutablePath(packaged))
    expect(sessionOptions({ cwd: '/repo', env, runtime: dev })).not.toHaveProperty('pathToClaudeCodeExecutable')
  })

  it('resumes a Session only when asked', () => {
    expect(sessionOptions({ cwd: '/repo', env, runtime: dev, resume: 'abc' }).resume).toBe('abc')
    expect(sessionOptions({ cwd: '/repo', env, runtime: dev })).not.toHaveProperty('resume')
  })
})
