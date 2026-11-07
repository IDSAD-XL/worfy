// An older build reads the state files a newer one wrote (worfy-polish ticket 63). Roll back
// (ADR-0089) starts the previous copy on the same data folder, so link/settings.json and limits.json
// written by the newer build must be read without being set aside, and the older build's next write
// must leave what the newer one added.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LimitsTracker, LIMITS_FILE } from '../../src/main/agent/limits'
import { LinkSettings } from '../../src/main/link/settings'
import { removeTestTree } from '../remove'

const MACHINE = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const AT = 1_791_000_000_000
const folders: string[] = []
const trackers: LimitsTracker[] = []

afterEach(() => {
  for (const tracker of trackers.splice(0)) tracker.stop()
  for (const folder of folders.splice(0)) removeTestTree(folder)
})

function folder(): string {
  const root = mkdtempSync(join(tmpdir(), 'worfy-newer-build-'))
  folders.push(root)
  return root
}

/** A link folder whose settings.json holds `content`. */
function linkDir(content: unknown): string {
  const dir = join(folder(), 'link')
  mkdirSync(dir)
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(content))
  return dir
}

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'))

describe('link/settings.json written by a newer build', () => {
  it('version 2 with keys this build does not know: read, not set aside, and the next write keeps them', () => {
    const newer = { version: 2, projectsAccess: true, machines: { [MACHINE]: 'read' }, keepAwake: false, tailscale: true, aNewSwitch: { on: true, since: '2026-11-07' } }
    const dir = linkDir(newer)
    const warnings: string[] = []
    const settings = new LinkSettings(dir, { warn: (message) => warnings.push(message), linked: () => [MACHINE] })

    expect(settings.get()).toEqual({ projectsAccess: true, machines: { [MACHINE]: 'read' }, keepAwake: false, tailscale: true })
    expect(readdirSync(dir)).toEqual(['settings.json'])

    settings.setLevel(OTHER, 'all')
    expect(readJson(join(dir, 'settings.json'))).toEqual({ ...newer, machines: { [MACHINE]: 'read', [OTHER]: 'all' } })
    expect(warnings).toEqual([])
  })

  it('a version newer than this build knows: not set aside, access stays off, and the file is never rewritten', () => {
    const newer = { version: 3, projectsAccess: true, machines: { [MACHINE]: 'write' }, keepAwake: false, scopes: { [MACHINE]: ['project-a'] } }
    const dir = linkDir(newer)
    const file = join(dir, 'settings.json')
    const before = readFileSync(file, 'utf8')
    const warnings: string[] = []
    const settings = new LinkSettings(dir, { warn: (message) => warnings.push(message), linked: () => [MACHINE] })

    expect(readdirSync(dir)).toEqual(['settings.json'])
    expect(settings.get()).toEqual({ projectsAccess: false, machines: {}, keepAwake: true, tailscale: false })
    expect(settings.levelOf(MACHINE)).toBe('off')
    expect(warnings.join('\n')).toMatch(/version 3/)

    // A change from Settings is refused with a text the user sees, not kept in memory until a restart.
    const events: boolean[] = []
    settings.on('changed', (value) => events.push(value.projectsAccess))
    const refusal = 'Link settings were written by a newer worfy build (file version 3); update worfy to change them'
    expect(() => settings.set({ projectsAccess: true })).toThrow(refusal)
    expect(() => settings.setLevel(MACHINE, 'read')).toThrow(refusal)
    expect(() => settings.set({ keepAwake: false })).toThrow(refusal)
    expect(() => settings.set({ tailscale: true })).toThrow(refusal)
    expect(events).toEqual([])
    expect(settings.get()).toEqual({ projectsAccess: false, machines: {}, keepAwake: true, tailscale: false })

    // The service's own clearing of a level on link and unlink (service.ts) changes nothing and does not throw.
    expect(settings.setLevel(OTHER, 'off')).toEqual({ projectsAccess: false, machines: {}, keepAwake: true, tailscale: false })
    expect(settings.set({ projectsAccess: false })).toEqual({ projectsAccess: false, machines: {}, keepAwake: true, tailscale: false })

    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(readdirSync(dir)).toEqual(['settings.json'])
  })

  it('version 1 with keys this build does not know: rewritten as version 2 at once, and the keys stay', () => {
    const dir = linkDir({ version: 1, projectsAccess: true, keepAwake: false, aNewSwitch: 'on' })
    const settings = new LinkSettings(dir, { warn: () => undefined, linked: () => [MACHINE] })
    expect(settings.get()).toEqual({ projectsAccess: true, machines: { [MACHINE]: 'all' }, keepAwake: false, tailscale: false })
    expect(readJson(join(dir, 'settings.json'))).toEqual({ version: 2, projectsAccess: true, machines: { [MACHINE]: 'all' }, keepAwake: false, tailscale: false, aNewSwitch: 'on' })
    expect(readdirSync(dir)).toEqual(['settings.json'])
  })

  it('a file that is not JSON is still set aside', () => {
    const dir = join(folder(), 'link')
    mkdirSync(dir)
    writeFileSync(join(dir, 'settings.json'), '{ "version": 2, ')
    const settings = new LinkSettings(dir, { warn: () => undefined })
    expect(settings.get().projectsAccess).toBe(false)
    expect(readdirSync(dir).some((name) => name.startsWith('settings.json.unreadable-'))).toBe(true)
  })
})

describe('limits.json written by a newer build', () => {
  const window = (receivedAt: number, extra: Record<string, unknown> = {}) => ({ utilization: 0.4, resetsAt: 1791184200, status: 'allowed', receivedAt, source: 'sdk', ...extra })

  it('keys and fields this build does not know: read, not set aside, and the next write keeps them', () => {
    const dataDir = folder()
    const file = join(dataDir, LIMITS_FILE)
    const newer = {
      windows: {
        seven_day: window(AT, { source: 'a-source-of-a-newer-build', windowMinutes: 10080 }),
        five_hour: window(AT),
      },
      vendors: { codex: { primary: { usedPercent: 12 } } },
    }
    writeFileSync(file, JSON.stringify(newer))
    const tracker = new LimitsTracker({ dataDir, watch: null })
    trackers.push(tracker)

    expect(readdirSync(dataDir)).toEqual([LIMITS_FILE])
    expect(tracker.snapshot().windows.seven_day).toMatchObject({ status: 'allowed', resetsAt: 1791184200 })

    // This build updates the 5-hour window only; the 7-day one and the top-level key stay as the newer build wrote them.
    tracker.record([{ window: 'five_hour', state: { utilization: 0.5, resetsAt: 1791184200, status: 'allowed', receivedAt: AT + 1000, source: 'sdk' } }])
    expect(readJson(file)).toEqual({ ...newer, windows: { ...newer.windows, five_hour: window(AT + 1000, { utilization: 0.5 }) } })
  })

  it('a file that is not JSON is still set aside', () => {
    const dataDir = folder()
    writeFileSync(join(dataDir, LIMITS_FILE), '{ "windows": ')
    const tracker = new LimitsTracker({ dataDir, watch: null })
    trackers.push(tracker)
    expect(tracker.snapshot()).toEqual({ windows: {} })
    expect(readdirSync(dataDir).some((name) => name.startsWith(`${LIMITS_FILE}.unreadable-`))).toBe(true)
  })
})
