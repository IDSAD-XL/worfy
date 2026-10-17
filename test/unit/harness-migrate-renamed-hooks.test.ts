// The move of the old Harness when the plugin renamed a hook (worfy-windows ticket 04): the plugin's
// hooks are Node scripts, so an old ~/.claude/hooks/<name>.sh is the plugin's hooks/<name>.mjs and
// is offered for removal, together with the settings.json record that runs it. A .sh the plugin has
// under neither name stays "Keep" only. Temporary folders stand in for the home folder, ~/.claude
// and the plugin; only the rows of the plan are checked, no path as it is shown.
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildPlan } from '../../src/main/harness/migrate/plan'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function file(path: string, text = '#!/bin/sh\n'): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}

/** A home folder with the old hooks stop.sh and foo.sh, both run by Stop records, and a plugin with hooks/stop.mjs. */
async function homes(): Promise<{ home: string; claudeHome: string; harnessHome: string }> {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'worfy-migrate-renamed-')))
  dirs.push(home)
  const claudeHome = join(home, '.claude')
  const harnessHome = join(claudeHome, 'worfy-harness')
  await file(join(claudeHome, 'hooks', 'stop.sh'))
  await file(join(claudeHome, 'hooks', 'foo.sh'))
  const stop = (command: string): unknown => ({ hooks: [{ type: 'command', command }] })
  await file(join(claudeHome, 'settings.json'), JSON.stringify({ hooks: { Stop: [stop('$HOME/.claude/hooks/stop.sh'), stop('$HOME/.claude/hooks/foo.sh')] } }))
  await file(join(harnessHome, 'plugin', 'hooks', 'stop.mjs'), '#!/usr/bin/env node\n')
  return { home, claudeHome, harnessHome }
}

describe('the move of the old Harness: hooks the plugin renamed to .mjs', () => {
  it('offers an old hooks/<name>.sh for removal when the plugin has hooks/<name>.mjs, and its settings.json record with it; another .sh stays', async () => {
    const { home, claudeHome, harnessHome } = await homes()
    const { view } = buildPlan({
      claudeHome,
      harnessHome,
      claudeJson: join(home, '.claude.json'),
      userHome: home,
      bridgeScript: null,
      offered: true,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      pluginState: { kind: 'installed', version: '0.2.0+aaaaaaa', enabled: true },
    })
    const byId = (id: string) => view.rows.find((row) => row.id === id)
    const hookRow = (name: string) => view.rows.find((row) => row.group === 'hooks' && row.label === `$HOME/.claude/hooks/${name}`)

    const stopFile = byId(`file:${join('hooks', 'stop.sh')}`)
    expect(stopFile?.choices).toEqual(['remove', 'keep'])
    expect(stopFile?.note).toBeNull()
    expect(hookRow('stop.sh')?.choices).toEqual(['remove', 'keep'])
    expect(hookRow('stop.sh')?.note).toBeNull()

    const fooFile = byId(`file:${join('hooks', 'foo.sh')}`)
    expect(fooFile?.choices).toEqual(['keep'])
    expect(fooFile?.note).toContain('not in the plugin')
    expect(hookRow('foo.sh')?.choices).toEqual(['keep'])
    expect(hookRow('foo.sh')?.note).toContain('not in the plugin')
  })
})
