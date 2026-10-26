// "Link through Tailscale" in link/settings.json (worfy-link ticket 27; ADR-0070, point 3): off for
// a fresh data folder and for every file written before the setting existed; on survives a re-read.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LinkSettings } from '../../src/main/link/settings'
import { removeTestTree } from '../remove'

const MACHINE = '22222222-2222-4222-8222-222222222222'
const folders: string[] = []

afterEach(() => {
  for (const folder of folders.splice(0)) removeTestTree(folder)
})

/** A link folder, with settings.json holding `content` when given. */
function linkDir(content?: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'worfy-link-settings-'))
  folders.push(root)
  const dir = join(root, 'link')
  mkdirSync(dir)
  if (content !== undefined) writeFileSync(join(dir, 'settings.json'), JSON.stringify(content))
  return dir
}

const quiet = { warn: () => undefined, linked: () => [MACHINE] }

describe('"Link through Tailscale" in link/settings.json', () => {
  it('is off for a fresh data folder', () => {
    expect(new LinkSettings(linkDir(), quiet).get().tailscale).toBe(false)
  })

  it('is off in a version 2 file written before the setting existed, and the rest of that file is kept', () => {
    const settings = new LinkSettings(linkDir({ version: 2, projectsAccess: true, machines: { [MACHINE]: 'read' }, keepAwake: false }), quiet)
    expect(settings.get()).toEqual({ projectsAccess: true, machines: { [MACHINE]: 'read' }, keepAwake: false, tailscale: false })
  })

  it('is off in a version 1 file', () => {
    expect(new LinkSettings(linkDir({ version: 1, projectsAccess: true, keepAwake: true }), quiet).get().tailscale).toBe(false)
  })

  it('is off when the file cannot be read', () => {
    const dir = linkDir()
    writeFileSync(join(dir, 'settings.json'), '{ not json')
    expect(new LinkSettings(dir, quiet).get().tailscale).toBe(false)
  })

  it('on is written, announced once and read back; off again likewise', () => {
    const dir = linkDir()
    const settings = new LinkSettings(dir, quiet)
    const events: boolean[] = []
    settings.on('changed', (value) => events.push(value.tailscale))
    settings.set({ tailscale: true })
    settings.set({ tailscale: true })
    expect(events).toEqual([true])
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ version: 2, projectsAccess: false, machines: {}, keepAwake: true, tailscale: true })
    expect(new LinkSettings(dir, quiet).get().tailscale).toBe(true)
    // Another switch leaves it as it is.
    settings.set({ keepAwake: false })
    expect(new LinkSettings(dir, quiet).get()).toEqual({ projectsAccess: false, machines: {}, keepAwake: false, tailscale: true })
    settings.set({ tailscale: false })
    expect(events).toEqual([true, true, false])
    expect(new LinkSettings(dir, quiet).get().tailscale).toBe(false)
  })
})
