// The move of the old Harness out of ~/.claude (worfy-harness ticket 14): paths that lead outside,
// changes made while the move runs, and what restore.mjs does with changes made after it. Moved out
// of harness-migrate.test.ts for worfy-windows ticket 28 (the gate warns about a file longer than
// 1000 lines); the sandbox and the helpers are in harness-migrate-harness.ts.
import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyMigration } from '../../src/main/harness/migrate/apply'
import { treeHash } from '../../src/main/harness/migrate/restore'
import { applyOptions, backupDir, everything, findNode, hookCommands, omit, pathWithoutClaude, plan, read, readJson, run, sandbox, selection, treeOf, useSandbox } from './harness-migrate-harness'

useSandbox()

describe('boundaries, races and what changed after the move', () => {
  const node = (): string => findNode()
  const runRestore = (): { status: number | null; stdout: string; stderr: string } =>
    run(node(), [join(backupDir(), 'restore.mjs'), '--keep-plugin'], { env: { ...sandbox.env, PATH: pathWithoutClaude() }, cwd: sandbox.root })

  it('a Harness folder that is a symlink leading outside ~/.claude: refused, nothing written, the outside files untouched', async () => {
    const outside = join(sandbox.root, 'outside-hooks')
    renameSync(join(sandbox.claudeHome, 'hooks'), outside)
    symlinkSync(outside, join(sandbox.claudeHome, 'hooks'))
    const before = treeOf(sandbox.root, everything)
    const result = await applyMigration(selection(plan()), applyOptions())
    expect(result.outcome).toBe('refused')
    // The path in the reason is joined with the separator of the system.
    expect(result.outcome === 'refused' ? result.reason : '').toMatch(/^refusing hooks[\\/].+: its folder leads outside/)
    expect(treeOf(sandbox.root, everything)).toEqual(before)
  })

  it('restore.mjs refuses a manifest path leading out of its homes ("../") before it changes anything', async () => {
    expect((await applyMigration(selection(plan()), applyOptions())).outcome).toBe('done')
    const victim = join(sandbox.root, 'outside.txt')
    writeFileSync(victim, 'not the Harness\n')
    const manifestPath = join(backupDir(), 'manifest.json')
    const manifest = readJson(manifestPath) as { created: string[]; claude: string[] }
    for (const tamper of [
      { ...manifest, created: [...manifest.created, join('..', '..', '..', 'outside.txt')] },
      { ...manifest, claude: [join('..', '..', 'outside.txt'), ...manifest.claude] },
    ]) {
      writeFileSync(manifestPath, JSON.stringify(tamper))
      const before = treeOf(sandbox.root, everything)
      const restored = runRestore()
      expect(restored.status).toBe(1)
      expect(restored.stderr).toMatch(/^restore failed: refusing a path outside /)
      expect(treeOf(sandbox.root, everything)).toEqual(before)
    }
    expect(read(victim)).toBe('not the Harness\n')
  })

  it('restore.mjs keeps what changed after the move in <backup>/after/: a lesson, a rules.md edit, settings.json, a new lock', async () => {
    expect((await applyMigration(selection(plan()), applyOptions())).outcome).toBe('done')
    const projects = join(sandbox.harnessHome, 'projects')
    writeFileSync(join(projects, 'atakama', 'lessons', 'retro-2026-10-09.md'), 'a lesson /retro wrote after the move\n')
    writeFileSync(join(projects, 'worfy', 'rules.md'), `${read(join(projects, 'worfy', 'rules.md'))}- a rule added after the move\n`)
    const settingsPath = join(sandbox.claudeHome, 'settings.json')
    const settings = readJson(settingsPath)
    writeFileSync(settingsPath, `${JSON.stringify({ ...settings, theme: 'light' }, null, 2)}\n`)
    mkdirSync(join(sandbox.claudeHome, 'gate', 'state'), { recursive: true })
    writeFileSync(join(sandbox.claudeHome, 'gate', 'state', 'red-new'), 'a marker an old gate wrote after the move\n')

    const restored = runRestore()
    expect(restored.stderr).toBe('')
    expect(restored.status).toBe(0)
    const after = join(backupDir(), 'after')
    expect(read(join(after, 'harness', 'projects', 'atakama', 'lessons', 'retro-2026-10-09.md'))).toBe('a lesson /retro wrote after the move\n')
    expect(read(join(after, 'harness', 'projects', 'worfy', 'rules.md'))).toContain('- a rule added after the move')
    expect(readJson(join(after, 'claude', 'settings.json')).theme).toBe('light')
    expect(read(join(after, 'claude', 'gate', 'state', 'red-new'))).toBe('a marker an old gate wrote after the move\n')
    // What the move left untouched is not in after/: an unchanged Profile file was simply taken away.
    expect(existsSync(join(after, 'harness', 'projects', 'auction'))).toBe(false)
    expect(existsSync(join(after, 'claude', 'CLAUDE.md'))).toBe(false)
    // The old places hold the backup's versions again.
    expect(readJson(settingsPath).theme).toBe('dark')
    expect(existsSync(join(projects, 'worfy'))).toBe(false)
  })

  // Windows: 8.3 s alone on the PC (2026-10-19); twice that. Timed out at 15 s in a full run.
  it('a second restore.mjs keeps what the first one saved in after/: it says the backup is restored and changes nothing', async () => {
    expect((await applyMigration(selection(plan()), applyOptions())).outcome).toBe('done')
    const settingsPath = join(sandbox.claudeHome, 'settings.json')
    writeFileSync(settingsPath, `${JSON.stringify({ ...readJson(settingsPath), theme: 'light' }, null, 2)}\n`)
    const saved = join(backupDir(), 'after', 'claude', 'settings.json')
    expect(runRestore().status).toBe(0)
    expect(readJson(saved).theme).toBe('light')
    const before = treeOf(sandbox.root, everything)
    const again = runRestore()
    expect(again.status).toBe(0)
    expect(again.stdout).toMatch(/^Already restored at .+ from this backup: nothing to do\./m)
    expect(readJson(saved).theme).toBe('light')
    expect(treeOf(sandbox.root, everything)).toEqual(before)
  }, process.platform === 'win32' ? 17_000 : undefined)

  it('a failed move kept a change in after/, then the owner runs restore.mjs of that backup: the change is still there', async () => {
    const settingsPath = join(sandbox.claudeHome, 'settings.json')
    const result = await applyMigration(
      selection(plan()),
      applyOptions({
        afterStep: (step) => {
          if (step !== 'claude-md') return
          writeFileSync(settingsPath, `${JSON.stringify({ ...readJson(settingsPath), theme: 'light' }, null, 2)}\n`)
          throw new Error('injected after a live write')
        },
      }),
    )
    expect(result).toMatchObject({ outcome: 'failed', rolledBack: true, backupDir: backupDir() })
    const saved = join(backupDir(), 'after', 'claude', 'settings.json')
    expect(readJson(saved).theme).toBe('light')
    const restored = runRestore()
    expect(restored.status).toBe(0)
    expect(readJson(saved).theme).toBe('light')
  })

  it('a restore that stopped before it was marked done: the next run saves into a new after-<n>/, never over after/', async () => {
    expect((await applyMigration(selection(plan()), applyOptions())).outcome).toBe('done')
    const settingsPath = join(sandbox.claudeHome, 'settings.json')
    writeFileSync(settingsPath, `${JSON.stringify({ ...readJson(settingsPath), theme: 'light' }, null, 2)}\n`)
    expect(runRestore().status).toBe(0)
    // As if the first run had stopped before marking the backup restored.
    const manifestPath = join(backupDir(), 'manifest.json')
    writeFileSync(manifestPath, JSON.stringify(omit(readJson(manifestPath), 'restoredAt')))
    expect(runRestore().status).toBe(0)
    expect(readJson(join(backupDir(), 'after', 'claude', 'settings.json')).theme).toBe('light')
    expect(readJson(join(backupDir(), 'after-2', 'claude', 'settings.json')).theme).toBe('dark')
  })

  it('restore.mjs and the move fingerprint files the same way', async () => {
    expect((await applyMigration(selection(plan()), applyOptions())).outcome).toBe('done')
    const script = (await import(/* @vite-ignore */ pathToFileURL(join(backupDir(), 'restore.mjs')).href)) as { treeHash: (path: string) => string | null }
    for (const path of [sandbox.pluginDir, join(sandbox.claudeHome, 'settings.json'), join(sandbox.claudeHome, 'skills'), join(sandbox.root, 'missing')]) {
      expect(script.treeHash(path)).toBe(treeHash(path))
    }
    symlinkSync('settings.json', join(sandbox.root, 'link'))
    expect(script.treeHash(join(sandbox.root, 'link'))).toBe(treeHash(join(sandbox.root, 'link')))
  })

  it('a state file a live Session writes during the move stays where it is; the files the backup copied leave', async () => {
    const lock = join(sandbox.claudeHome, 'worktree-sessions', 'live-session.json')
    const result = await applyMigration(
      selection(plan()),
      applyOptions({
        beforeStep: (step) => {
          if (step === 'state') writeFileSync(lock, '{"session":"live"}\n')
        },
      }),
    )
    expect(result.outcome).toBe('done')
    expect(read(lock)).toBe('{"session":"live"}\n')
    expect(readdirSync(join(sandbox.claudeHome, 'worktree-sessions'))).toEqual(['live-session.json'])
    expect(existsSync(join(sandbox.claudeHome, 'gate', 'state'))).toBe(false)
    expect(existsSync(join(sandbox.harnessHome, 'worktree-sessions', 'sandbox-repos-worfy-0000aaaa.json'))).toBe(true)
  })

  it('CLAUDE.md changed during the move: the step fails, the move is undone, and the edit stays in CLAUDE.md (the move never wrote it)', async () => {
    const claudeMd = join(sandbox.claudeHome, 'CLAUDE.md')
    const edited = `${read(claudeMd)}\n## Written during the move\n`
    const result = await applyMigration(
      selection(plan()),
      applyOptions({
        beforeStep: (step) => {
          if (step === 'claude-md') writeFileSync(claudeMd, edited)
        },
      }),
    )
    expect(result).toMatchObject({ outcome: 'failed', step: 'claude-md', rolledBack: true, backupDir: null })
    expect(result.outcome === 'failed' ? result.reason : '').toContain('CLAUDE.md changed during the move')
    expect(read(claudeMd)).toBe(edited)
    expect(existsSync(join(sandbox.claudeHome, 'agents', 'scout.md'))).toBe(true)
  })

  it('a file changed during the move after the move wrote it: undone, and the change is kept in after/', async () => {
    const settingsPath = join(sandbox.claudeHome, 'settings.json')
    const original = read(settingsPath)
    const result = await applyMigration(
      selection(plan()),
      applyOptions({
        afterStep: (step) => {
          if (step !== 'claude-md') return
          writeFileSync(settingsPath, `${JSON.stringify({ ...readJson(settingsPath), theme: 'light' }, null, 2)}\n`)
          throw new Error('injected after a live write')
        },
      }),
    )
    expect(result).toMatchObject({ outcome: 'failed', step: 'claude-md', rolledBack: true, backupDir: backupDir() })
    expect(read(settingsPath)).toBe(original)
    expect(readJson(join(backupDir(), 'after', 'claude', 'settings.json')).theme).toBe('light')
  })

  it('settings.json changed during the move: the step fails rather than dropping the wrong hook records', async () => {
    const settingsPath = join(sandbox.claudeHome, 'settings.json')
    const result = await applyMigration(
      selection(plan()),
      applyOptions({
        beforeStep: (step) => {
          if (step !== 'settings') return
          const settings = readJson(settingsPath) as { hooks: Record<string, unknown[]> }
          settings.hooks.SessionStart?.unshift({ hooks: [{ type: 'command', command: 'echo new' }] })
          writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
        },
      }),
    )
    expect(result).toMatchObject({ outcome: 'failed', step: 'settings', rolledBack: true })
    expect(result.outcome === 'failed' ? result.reason : '').toContain('settings.json changed during the move')
    expect(hookCommands(settingsPath)[0]).toBe('echo new')
  })

  it.each(['settings.json', 'CLAUDE.md', '.claude.json'])('a symlinked %s is refused with the reason, not replaced by a file', async (name) => {
    const path = join(sandbox.claudeHome, name)
    const real = join(sandbox.root, `real-${name}`)
    renameSync(path, real)
    symlinkSync(real, path)
    const before = treeOf(sandbox.root, everything)
    const result = await applyMigration(selection(plan()), applyOptions())
    expect(result.outcome).toBe('refused')
    expect(result.outcome === 'refused' ? result.reason : '').toBe(`${path} is a symbolic link: the move would replace it with a file. Replace the link with the file it points to, or keep the rows that change it`)
    expect(treeOf(sandbox.root, everything)).toEqual(before)
    expect(lstatSync(path).isSymbolicLink()).toBe(true)
  })
})
