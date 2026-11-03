// What a Session reads of its Vendor's driver besides the session part (src/main/agent/session.ts,
// SessionVendorParts; worfy-multi-vendor ticket 25): the capabilities, which a settings change must keep
// to, and the rows of the slash menu from the driver's commands part; and the settings put in the
// Vendor's own terms before the Session starts (SessionPart.settingsFor). Claude Code on the fake agent
// stands in for any Vendor: the parts given here are a test's.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryFactory } from '../../src/main/agent/fake-query'
import { SessionRegistry, type SessionVendorParts } from '../../src/main/agent/session'
import { claudeSessions } from '../../src/main/vendors/claude/session'
import type { SessionPart } from '../../src/main/vendors/session'
import type { SlashCommand } from '../../src/shared/agent/commands'
import { DEFAULT_SETTINGS } from '../../src/shared/agent/settings'
import { CLAUDE_CAPABILITIES, type Capabilities } from '../../src/shared/vendors/capabilities'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/nowhere', on: vi.fn() } }))

const fixtures = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'fixtures', 'agent-scripts')

const ROWS: SlashCommand[] = [{ name: 'triage', description: 'Sort the issues', argumentHint: '', kind: 'skill' }]

/** A Vendor that offers two of Claude Code's modes and one effort level. */
const NARROW: Capabilities = {
  ...CLAUDE_CAPABILITIES,
  permissionPresets: CLAUDE_CAPABILITIES.permissionPresets.filter((preset) => preset.id === 'bypassPermissions' || preset.id === 'plan'),
  effortLevels: ['high'],
}

let cwd: string
let emptyHome: string
let registries: SessionRegistry[] = []

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'worfy-vendor-parts-'))
  emptyHome = await mkdtemp(join(tmpdir(), 'worfy-vendor-parts-home-'))
  vi.stubEnv('WORFY_CLAUDE_HOME', emptyHome)
})

afterEach(async () => {
  for (const registry of registries) registry.closeAll()
  registries = []
  vi.unstubAllEnvs()
  await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  await rm(emptyHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

function registryWith(parts: SessionVendorParts, sessions: (claude: SessionPart) => SessionPart = (claude) => claude): SessionRegistry {
  const claude = claudeSessions(fakeQueryFactory({ scriptsDir: fixtures, script: 'turn' }))
  const registry = new SessionRegistry({ sessionsOf: () => sessions(claude), partsOf: () => parts })
  registries.push(registry)
  return registry
}

const parts = (): SessionVendorParts & { capabilities: ReturnType<typeof vi.fn>; commands: { list: ReturnType<typeof vi.fn> } } => ({
  capabilities: vi.fn(() => Promise.resolve(NARROW)),
  commands: { list: vi.fn(() => Promise.resolve(ROWS)) },
})

describe("a Session and its Vendor's driver", () => {
  it('refuses a permission preset or an effort level its Vendor does not offer, and keeps its settings', async () => {
    const vendor = parts()
    const session = registryWith(vendor).start(cwd, undefined, () => undefined)
    await expect(session.configure({ permissionMode: 'acceptEdits' })).rejects.toThrow("acceptEdits is no permission preset of this Session's agent")
    await expect(session.configure({ effort: 'low' })).rejects.toThrow("low is no effort level of this Session's agent")
    expect(session.settings).toEqual(DEFAULT_SETTINGS)
    // What the Vendor offers goes through.
    expect(await session.configure({ permissionMode: 'plan', effort: 'high' })).toEqual({ ...DEFAULT_SETTINGS, permissionMode: 'plan', effort: 'high' })
    expect(vendor.capabilities).toHaveBeenCalled()
  })

  it("answers its capabilities and its slash menu from the driver's parts, with the live process's handle", async () => {
    const vendor = parts()
    const session = registryWith(vendor).start(cwd, undefined, () => undefined)
    await vi.waitFor(() => expect(session.state).toBe('idle'))
    expect(await session.capabilities()).toBe(NARROW)
    expect(vendor.capabilities.mock.calls.at(-1)?.[0]).toBeDefined()
    expect(await session.commands()).toBe(ROWS)
    expect(vendor.commands.list).toHaveBeenCalledTimes(1)
    expect(vendor.commands.list.mock.calls[0]?.[0]).toBe(vendor.capabilities.mock.calls.at(-1)?.[0])
  })

  it("starts with the settings in its Vendor's terms when the session part puts them so", async () => {
    const settingsFor = vi.fn((settings: typeof DEFAULT_SETTINGS) => ({ ...settings, permissionMode: 'plan' }))
    const session = registryWith(parts(), (claude) => ({ ...claude, settingsFor })).start(cwd, undefined, () => undefined)
    expect(settingsFor).toHaveBeenCalledWith(DEFAULT_SETTINGS)
    expect(session.settings).toEqual({ ...DEFAULT_SETTINGS, permissionMode: 'plan' })
  })
})
