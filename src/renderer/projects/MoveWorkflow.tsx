// The move of the workflow files beside `mode` in "Edit profile" (worfy-polish ticket 81): a Project in Full mode
// moves its tickets, specs, ADRs, glossary, lessons and state file out of the repository into a Workflow folder
// (Silent mode), one in Silent mode moves them back. The button opens a confirmation that says what moves from
// which path to which, with the Workflow folder to use for Silent mode (empty — the default one beside the
// Profile); the move itself is `profileEdit.move` (`bin/profile-set --move`), which EditProfile.tsx calls and
// whose answer it shows. A Project of several repositories has no Full mode: it gets no button back.
import { useState, type CSSProperties } from 'react'
import { isAbsolutePath } from '../../shared/paths'
import type { ProfileMode } from '../../shared/ipc/profile-edit'
import { fieldStyles } from './profile-fields'

export interface MoveWorkflowProps {
  /** The Project's mode now. */
  mode: ProfileMode
  /** The Project's repository (its root). */
  repository: string
  /** The Workflow folder of Silent mode now; null — the default one beside the Profile, or Full mode. */
  folder: string | null
  /** The Project has several repositories: Full mode is not offered. */
  severalRepos: boolean
  /** Why the move cannot start now (unsaved edits, another write running); null — it can. */
  blocked: string | null
  /** A move is running. */
  moving: boolean
  /** Runs the move: `folder` is the Workflow folder of Silent mode, null — the default one. */
  onMove: (to: ProfileMode, folder: string | null) => Promise<void>
}

const styles = {
  box: { gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', margin: '0 0 var(--space-2)' },
  confirm: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-button)', background: 'var(--surface-raised)' },
  row: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' },
  text: { margin: 0, fontSize: 'var(--text-12)', color: 'var(--text-secondary)' },
} satisfies Record<string, CSSProperties>

const FILES = 'The tickets, epic specs, ADRs, glossary, lessons kept in the repository and state file'
const STOPS = 'Uncommitted changes, a Session at work or an open PR of a ticket stop the move before anything changes.'
const DEFAULT_FOLDER = 'the default Workflow folder beside the profile'

/** What a move does, from which path to which, in the sentences the confirmation shows. */
function moveSummary(to: ProfileMode, repository: string, folder: string | null): string {
  return to === 'silent'
    ? `${FILES} move out of the repository ${repository} into ${folder === null ? DEFAULT_FOLDER : `the Workflow folder ${folder}`}: one commit removes them from the repository, one adds them to the folder. ${STOPS}`
    : `${FILES} move from ${folder === null ? DEFAULT_FOLDER : `the Workflow folder ${folder}`} back into the repository ${repository}: one commit adds them to the repository, one removes them from the folder. ${STOPS}`
}

export function MoveWorkflow({ mode, repository, folder: current, severalRepos, blocked, moving, onMove }: MoveWorkflowProps) {
  const to: ProfileMode = mode === 'silent' ? 'full' : 'silent'
  const label = to === 'silent' ? 'Move to Silent mode…' : 'Move to Full mode…'
  const [open, setOpen] = useState(false)
  const [folder, setFolder] = useState('')
  const chosen = folder.trim()
  const folderProblem = chosen !== '' && !isAbsolutePath(chosen) ? 'The Workflow folder must be an absolute path.' : null
  if (to === 'full' && severalRepos) {
    return (
      <div style={styles.box} data-testid="move-workflow">
        <span style={fieldStyles.hint}>A Project of several repositories stays in Silent mode: Full mode keeps the workflow files in one repository.</span>
      </div>
    )
  }

  const start = async (): Promise<void> => {
    if (moving || blocked !== null || folderProblem !== null) return
    await onMove(to, to === 'silent' && chosen !== '' ? chosen : null)
    setOpen(false)
    setFolder('')
  }

  return (
    <div style={styles.box} data-testid="move-workflow">
      {open ? (
        <div style={styles.confirm} role="group" aria-label={label.replace('…', '')}>
          <p style={styles.text} data-testid="move-workflow-summary">
            {moveSummary(to, repository, to === 'silent' ? (chosen === '' || folderProblem !== null ? null : chosen) : current)}
          </p>
          {to === 'silent' ? (
            <label style={fieldStyles.field}>
              <span style={fieldStyles.label}>Workflow folder</span>
              <input
                style={{ ...fieldStyles.input, ...(folderProblem ? fieldStyles.invalid : {}) }}
                value={folder}
                placeholder="Empty: the default folder beside the profile"
                disabled={moving}
                aria-invalid={folderProblem ? 'true' : undefined}
                onChange={(event) => setFolder(event.target.value)}
                data-testid="move-workflow-folder"
              />
              {folderProblem ? (
                <span role="alert" style={fieldStyles.fieldError}>
                  {folderProblem}
                </span>
              ) : null}
            </label>
          ) : null}
          <div style={styles.row}>
            <button
              type="button"
              className="w-action w-action--primary"
              disabled={moving || blocked !== null || folderProblem !== null}
              onClick={() => void start()}
              data-testid="move-workflow-confirm"
            >
              {moving ? 'Moving…' : 'Move files'}
            </button>
            <button type="button" className="w-action" disabled={moving} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={styles.row}>
          <button type="button" className="w-action" disabled={blocked !== null || moving} onClick={() => setOpen(true)} data-testid="move-workflow-open">
            {label}
          </button>
        </div>
      )}
      {blocked !== null ? <span style={fieldStyles.hint}>{blocked}</span> : null}
    </div>
  )
}
