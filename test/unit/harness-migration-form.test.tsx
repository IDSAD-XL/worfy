import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MigrationPlan, MigrationResult, MigrationSelection } from '../../src/shared/ipc/harness-migration'
import { MigrationFormView } from '../../src/renderer/harness/MigrationForm'
import { HarnessStatusView } from '../../src/renderer/shell/toolbar/HarnessStatus'

// worfy-harness ticket 14: the form that moves the old Harness out of ~/.claude. Rows by group, a
// "Remove / Keep" switch on each, CLAUDE.md and the Profile files as a diff, Move with the choices,
// and after a move the backup and the command that undoes it.

const plan = (extra: Partial<MigrationPlan> = {}): MigrationPlan => ({
  offered: true,
  available: true,
  missing: [],
  claudeHome: '/Users/me/.claude',
  harnessHome: '/Users/me/.claude/worfy-harness',
  claudeJson: '/Users/me/.claude.json',
  rows: [
    { id: 'file:agents/scout.md', group: 'files', label: '~/.claude/agents/scout.md', detail: null, choices: ['remove', 'keep'], defaultChoice: 'remove', note: null },
    { id: 'file:bin/tests', group: 'files', label: '~/.claude/bin/tests', detail: null, choices: ['keep'], defaultChoice: 'keep', note: 'not in the plugin: stays in ~/.claude' },
    {
      id: 'hook:Stop:0:0:$HOME/.claude/hooks/stop.sh',
      group: 'hooks',
      label: '$HOME/.claude/hooks/stop.sh',
      detail: 'Stop: {"type":"command","command":"$HOME/.claude/hooks/stop.sh"}',
      choices: ['remove', 'keep'],
      defaultChoice: 'remove',
      note: null,
    },
    { id: 'status-line', group: 'status-line', label: '/dev/scripts/statusline-bridge.sh', detail: null, choices: ['keep'], defaultChoice: 'keep', note: 'a development build: it has no status line bridge of its own' },
    { id: 'qmd', group: 'qmd', label: 'qmd of the old Harness', detail: '~/.claude/bin/qmd-mcp', choices: ['remove', 'keep'], defaultChoice: 'remove', note: 'The installed plugin does not register qmd yet' },
    { id: 'state:gate-config', group: 'state', label: '~/.claude/gate/config.json → ~/.claude/worfy-harness/gate/config.json', detail: null, choices: ['remove', 'keep'], defaultChoice: 'remove', note: null },
  ],
  claudeMd: {
    path: '~/.claude/CLAUDE.md',
    // An H1 between the two sections belongs to neither and always stays.
    text: '### Quota\n\nTwo counters.\n\n# Personal\n\n## My machine\n\nMine.',
    sections: [
      { id: 'claude-md:0:Quota', group: 'claude-md', label: 'Quota', detail: null, choices: ['remove', 'keep'], defaultChoice: 'remove', note: null, text: '### Quota\n\nTwo counters.\n', start: 0, end: 4 },
      { id: 'claude-md:1:My machine', group: 'claude-md', label: 'My machine', detail: null, choices: ['remove', 'keep'], defaultChoice: 'keep', note: null, text: '## My machine\n\nMine.', start: 6, end: 9 },
    ],
  },
  profiles: [
    {
      id: 'profile:worfy',
      group: 'profiles',
      label: '~/.claude/profiles/worfy → ~/.claude/worfy-harness/projects/worfy',
      detail: null,
      choices: ['remove', 'keep'],
      defaultChoice: 'remove',
      note: null,
      name: 'worfy',
      fields: { mode: 'full', languageDocs: 'ru', attribution: 'on' },
      modeReason: 'the tickets folder /r/.scratch is in the git repository /r',
      files: [
        {
          path: '~/.claude/profiles/worfy/profile.json',
          before: '{\n  "schema": 1,\n  "name": "worfy"\n}\n',
          after: '{\n  "schema": 2,\n  "name": "worfy",\n  "mode": "full",\n  "attribution": "on",\n  "language": {\n    "docs": "ru"\n  }\n}\n',
        },
        { path: '~/.claude/profiles/worfy/rules.md', before: 'gate: ~/.claude/hooks/gate.sh\n', after: 'gate: ~/.claude/worfy-harness/plugin/hooks/gate.sh\n' },
      ],
      carried: [],
    },
  ],
  warnings: ['Claude Code sessions that are already running started with the old hooks and keep them: restart them after the move.'],
  ...extra,
})

afterEach(cleanup)

const rowOf = (id: string): HTMLElement => {
  const row = screen.getAllByTestId('migration-row').find((element) => element.dataset.row === id)
  if (row === undefined) throw new Error(`no row ${id}`)
  return row
}
const moveButton = (): HTMLButtonElement => within(screen.getByTestId('migration-actions')).getByRole('button', { name: 'Move' })
const pressed = (row: HTMLElement): string[] =>
  within(row)
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.textContent ?? '')

/** Chooses `value` in the Select `testId`: a click on the button, then on the option. */
function pick(testId: string, value: string): void {
  fireEvent.click(screen.getByTestId(testId))
  const option = screen.getAllByRole('option').find((element) => element.getAttribute('data-value') === value)
  if (option === undefined) throw new Error(`no option ${value} in ${testId}`)
  fireEvent.click(option)
}

function renderForm(extra: { plan?: MigrationPlan; result?: MigrationResult; busy?: boolean } = {}) {
  const onMove = vi.fn<(selection: MigrationSelection) => void>()
  const onClose = vi.fn()
  render(<MigrationFormView plan={extra.plan ?? plan()} busy={extra.busy ?? false} result={extra.result} onMove={onMove} onClose={onClose} />)
  return { onMove, onClose }
}

describe('MigrationFormView', () => {
  it('shows the rows by group with their defaults; a row offering only Keep has no Remove', () => {
    renderForm()
    expect(screen.getAllByTestId('migration-group').map((group) => group.dataset.group)).toEqual(['files', 'hooks', 'status-line', 'qmd', 'state', 'claude-md', 'profiles'])
    expect(pressed(rowOf('file:agents/scout.md'))).toEqual(['Remove'])
    expect(within(rowOf('file:bin/tests')).getAllByRole('button').map((button) => button.textContent)).toEqual(['Keep'])
    expect(within(rowOf('file:bin/tests')).getByText('not in the plugin: stays in ~/.claude')).toBeTruthy()
    expect(pressed(rowOf('state:gate-config'))).toEqual(['Move'])
    expect(screen.getByTestId('migration-warning').textContent).toContain('restart them')
    expect(within(rowOf('qmd')).getByText('The installed plugin does not register qmd yet')).toBeTruthy()
  })

  it('the switches work: Keep and Remove change the row and what Move sends', () => {
    const { onMove } = renderForm()
    fireEvent.click(within(rowOf('file:agents/scout.md')).getByRole('button', { name: 'Keep' }))
    expect(rowOf('file:agents/scout.md').dataset.choice).toBe('keep')
    fireEvent.click(within(rowOf('claude-md:1:My machine')).getByRole('button', { name: 'Remove' }))
    fireEvent.click(moveButton())
    expect(onMove).toHaveBeenCalledWith({
      choices: {
        'file:agents/scout.md': 'keep',
        'file:bin/tests': 'keep',
        'hook:Stop:0:0:$HOME/.claude/hooks/stop.sh': 'remove',
        'status-line': 'keep',
        qmd: 'remove',
        'state:gate-config': 'remove',
        'claude-md:0:Quota': 'remove',
        'claude-md:1:My machine': 'remove',
        'profile:worfy': 'remove',
      },
      profiles: { worfy: { mode: 'full', languageDocs: 'ru', attribution: 'on' } },
    })
  })

  it('CLAUDE.md as a diff of the whole file: the lines of a removed section are marked, a kept one and text outside sections are not; switching changes the diff', () => {
    renderForm()
    const diff = (): { removed: string[]; same: string[] } => {
      const lines = Array.from(screen.getByTestId('claude-md-diff').querySelectorAll<HTMLElement>('[data-diff]'))
      return { removed: lines.filter((line) => line.dataset.diff === 'removed').map((line) => line.textContent ?? ''), same: lines.filter((line) => line.dataset.diff === 'same').map((line) => line.textContent ?? '') }
    }
    expect(diff().removed).toEqual(['- ### Quota', '- ', '- Two counters.', '- '])
    expect(diff().same).toEqual(['  # Personal', '  ', '  ## My machine', '  ', '  Mine.'])
    fireEvent.click(within(rowOf('claude-md:0:Quota')).getByRole('button', { name: 'Keep' }))
    expect(diff().removed).toEqual([])
    // Removing every section still keeps the text outside them.
    fireEvent.click(within(rowOf('claude-md:0:Quota')).getByRole('button', { name: 'Remove' }))
    fireEvent.click(within(rowOf('claude-md:1:My machine')).getByRole('button', { name: 'Remove' }))
    expect(diff().same).toEqual(['  # Personal', '  '])
  })

  it('a Profile: the diff of profile.json and rules.md follows the fields the owner sets, and Move sends them', () => {
    const { onMove } = renderForm()
    const added = (): string[] =>
      screen
        .getAllByTestId('profile-diff')
        .flatMap((diff) => Array.from(diff.querySelectorAll<HTMLElement>('[data-diff="added"]')))
        .map((line) => line.textContent ?? '')
    expect(added()).toEqual(expect.arrayContaining(['+   "schema": 2,', '+   "mode": "full",', '+   "attribution": "on",', '+ gate: ~/.claude/worfy-harness/plugin/hooks/gate.sh']))
    pick('profile-mode', 'silent')
    pick('profile-attribution', 'off')
    pick('profile-languageDocs', 'en')
    expect(screen.getByTestId('profile-mode').getAttribute('data-value')).toBe('silent')
    expect(added()).toEqual(expect.arrayContaining(['+   "mode": "silent",', '+   "attribution": "off",', '+     "docs": "en"']))
    fireEvent.click(moveButton())
    expect(onMove.mock.calls[0]?.[0].profiles).toEqual({ worfy: { mode: 'silent', languageDocs: 'en', attribution: 'off' } })
    // Kept: no diff, the fields cannot be changed.
    fireEvent.click(within(rowOf('profile:worfy')).getByRole('button', { name: 'Keep' }))
    expect(screen.queryAllByTestId('profile-diff')).toEqual([])
    expect((screen.getByTestId('profile-mode') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('profile-mode'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('a Profile field: Esc on its open list closes the list, not the form; the next Esc closes the form', () => {
    const { onClose } = renderForm()
    const field = screen.getByTestId('profile-mode')
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('migration-form')).toBeTruthy()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('without the plugin: the form names what is missing and Move is disabled', () => {
    const { onMove } = renderForm({ plan: plan({ available: false, missing: ['the plugin worfy is not installed: install it first (Install in the toolbar)'] }) })
    expect(screen.getByTestId('migration-missing').textContent).toBe('the plugin worfy is not installed: install it first (Install in the toolbar)')
    const move = moveButton()
    expect(move.disabled).toBe(true)
    fireEvent.click(move)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('after the move: the backup and the restore command; Move is gone and Cancel reads Close', () => {
    renderForm({ result: { outcome: 'done', backupDir: '/Users/me/.claude/worfy-harness/backup-2026-10-08-10-20-30', restoreCommand: 'node /Users/me/.claude/worfy-harness/backup-2026-10-08-10-20-30/restore.mjs' } })
    expect(screen.getByTestId('migration-backup').textContent).toBe('/Users/me/.claude/worfy-harness/backup-2026-10-08-10-20-30')
    expect(screen.getByTestId('migration-restore-command').textContent).toBe('node /Users/me/.claude/worfy-harness/backup-2026-10-08-10-20-30/restore.mjs')
    expect(within(screen.getByTestId('migration-actions')).queryByRole('button', { name: 'Move' })).toBeNull()
    expect(screen.getByTestId('migration-close').textContent).toBe('Close')
  })

  it('a failed step is named, with whether the move was undone', () => {
    renderForm({ result: { outcome: 'failed', step: 'settings', reason: 'EACCES', rolledBack: true, rollbackError: null, backupDir: null } })
    expect(screen.getByTestId('migration-error').textContent).toBe('The step “settings” failed: EACCES. The move was undone; ~/.claude is as it was.')
  })

  it('an undone move that kept files changed while it ran names where they are', () => {
    renderForm({ result: { outcome: 'failed', step: 'claude-md', reason: 'boom', rolledBack: true, rollbackError: null, backupDir: '/h/backup-1' } })
    expect(screen.getByTestId('migration-error').textContent).toBe('The step “claude-md” failed: boom. The move was undone. Files changed while it ran are kept in /h/backup-1/after/.')
  })
})

describe('HarnessStatusView: the move button', () => {
  const status = { state: { kind: 'installed' as const, version: '0.2.0+bbbbbbb', enabled: true }, bundledVersion: '0.2.0+bbbbbbb', canInstall: true, pluginDir: '/p', dependencies: [] }
  it('shows "Move old Harness…" only when main offers a move', () => {
    const onMigrate = vi.fn()
    const { rerender } = render(<HarnessStatusView status={status} busy={false} failure={undefined} onInstall={() => undefined} />)
    expect(screen.queryByTestId('harness-migrate')).toBeNull()
    rerender(<HarnessStatusView status={status} busy={false} failure={undefined} onInstall={() => undefined} onMigrate={onMigrate} />)
    fireEvent.click(screen.getByTestId('harness-migrate'))
    expect(onMigrate).toHaveBeenCalledOnce()
  })
})
