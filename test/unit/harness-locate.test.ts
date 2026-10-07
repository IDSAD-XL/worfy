// Which Harness is on the machine (worfy-harness ticket 12): the plugin in <harnessHome>/plugin/,
// the old Harness in <claudeHome>/bin/, both, or neither. Temporary folders stand in for
// ~/.claude and ~/.claude/worfy-harness.
import { chmod, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { currentHarness, locateHarness } from '../../src/main/harness/locate'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function homes(): Promise<{ claudeHome: string; harnessHome: string }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'worfy-locate-')))
  dirs.push(dir)
  const claudeHome = join(dir, 'claude')
  await mkdir(claudeHome)
  return { claudeHome, harnessHome: join(claudeHome, 'worfy-harness') }
}

async function script(path: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, '#!/bin/sh\n')
  await chmod(path, 0o755)
}

/** <harnessHome>/plugin with a manifest named `name` and, unless `epicStatus` is false, bin/epic-status. */
async function plugin(harnessHome: string, manifest: string = JSON.stringify({ name: 'worfy', version: '0.2.0+abc' }), epicStatus = true): Promise<void> {
  await mkdir(join(harnessHome, 'plugin', '.claude-plugin'), { recursive: true })
  await writeFile(join(harnessHome, 'plugin', '.claude-plugin', 'plugin.json'), manifest)
  if (epicStatus) await script(join(harnessHome, 'plugin', 'bin', 'epic-status'))
}

const legacy = (claudeHome: string): Promise<void> => script(join(claudeHome, 'bin', 'epic-status'))

describe('locateHarness', () => {
  it('finds the plugin when only <harnessHome>/plugin is there: scripts in its bin/, Gate state in <harnessHome>/gate', async () => {
    const { claudeHome, harnessHome } = await homes()
    await plugin(harnessHome)
    expect(locateHarness({ claudeHome, harnessHome })).toEqual({
      kind: 'plugin',
      binDir: join(harnessHome, 'plugin', 'bin'),
      gateDir: join(harnessHome, 'gate'),
      harnessHome,
      checked: [join(claudeHome, 'bin', 'epic-status'), join(harnessHome, 'plugin', 'bin', 'epic-status')],
    })
  })

  it('finds the old Harness when only <claudeHome>/bin/epic-status is there: scripts and Gate state as before', async () => {
    const { claudeHome, harnessHome } = await homes()
    await legacy(claudeHome)
    expect(locateHarness({ claudeHome, harnessHome })).toMatchObject({ kind: 'legacy', binDir: join(claudeHome, 'bin'), gateDir: join(claudeHome, 'gate') })
  })

  it('takes the old Harness when both are there: its hooks are still in settings.json, the plugin would run them twice', async () => {
    const { claudeHome, harnessHome } = await homes()
    await legacy(claudeHome)
    await plugin(harnessHome)
    expect(locateHarness({ claudeHome, harnessHome })).toMatchObject({ kind: 'legacy', binDir: join(claudeHome, 'bin'), gateDir: join(claudeHome, 'gate') })
  })

  it('finds none when neither is there, and names both paths it checked', async () => {
    const { claudeHome, harnessHome } = await homes()
    const found = locateHarness({ claudeHome, harnessHome })
    expect(found.kind).toBe('none')
    expect(found.checked).toEqual([join(claudeHome, 'bin', 'epic-status'), join(harnessHome, 'plugin', 'bin', 'epic-status')])
    // Reading goes on where it went before the plugin: a missing <claudeHome>/bin script, <claudeHome>/gate.
    expect(found).toMatchObject({ binDir: join(claudeHome, 'bin'), gateDir: join(claudeHome, 'gate') })
  })

  it.each([
    ['a manifest with another name', JSON.stringify({ name: 'other' }), true],
    ['a manifest that is not JSON', '{ name: worfy', true],
    ['a manifest that is not an object', '"worfy"', true],
    ['a plugin without bin/epic-status', JSON.stringify({ name: 'worfy' }), false],
  ])('does not take %s for the plugin', async (_case, manifest, epicStatus) => {
    const { claudeHome, harnessHome } = await homes()
    await plugin(harnessHome, manifest, epicStatus)
    expect(locateHarness({ claudeHome, harnessHome }).kind).toBe('none')
  })

  it('does not take a plugin folder without a manifest', async () => {
    const { claudeHome, harnessHome } = await homes()
    await script(join(harnessHome, 'plugin', 'bin', 'epic-status'))
    expect(locateHarness({ claudeHome, harnessHome }).kind).toBe('none')
  })

  it('sees the machine switch to the plugin on the next call, without a restart', async () => {
    const { claudeHome, harnessHome } = await homes()
    await legacy(claudeHome)
    await plugin(harnessHome)
    expect(locateHarness({ claudeHome, harnessHome }).kind).toBe('legacy')
    // The move (ticket 14) takes the old scripts away.
    await rm(join(claudeHome, 'bin'), { recursive: true })
    expect(locateHarness({ claudeHome, harnessHome }).kind).toBe('plugin')
  })

  it('writes nothing under either home', async () => {
    const { claudeHome, harnessHome } = await homes()
    await legacy(claudeHome)
    await plugin(harnessHome)
    const listing = async (): Promise<string[]> => (await readdir(claudeHome, { recursive: true })).sort()
    const before = await listing()
    locateHarness({ claudeHome, harnessHome })
    expect(await listing()).toEqual(before)
  })
})

describe('currentHarness', () => {
  it('looks in WORFY_CLAUDE_HOME and in WORFY_HARNESS_HOME, or <WORFY_CLAUDE_HOME>/worfy-harness without it', async () => {
    const { claudeHome, harnessHome } = await homes()
    await plugin(harnessHome)
    expect(currentHarness({ WORFY_CLAUDE_HOME: claudeHome })).toMatchObject({ kind: 'plugin', harnessHome })
    const elsewhere = join(claudeHome, 'elsewhere')
    expect(currentHarness({ WORFY_CLAUDE_HOME: claudeHome, WORFY_HARNESS_HOME: elsewhere })).toMatchObject({ kind: 'none', harnessHome: elsewhere })
  })
})
