// The owner's mark in the view of a PR (worfy-harness-guarantees ticket 10; the spec of that Epic, Q3 (a)): a PR that
// adds a verification path to the trail of a Ticket, or that has no Ticket and changes one, merges through `land` only
// with the commit status `owner` success on its head. The strip under the facts says what the mark allows and offers
// Allow verification change; the click is the only way the status is written (`prInbox.allowVerification`,
// src/main/github/owner-mark.ts). Opening the view reads only (`prInbox.verification`): the look runs `land
// --verification` of the Harness, never a write.
//
//   Verification paths: adds .github/workflows/ci.yml to the trail of worfy-x 07
//   [Allow verification change]
//
// Nothing shows for a PR that needs no mark, on a Linked machine (the channels are local), or when the look failed —
// that one says why in a muted line. A head that moved since the look is refused by main with the new head, and the
// strip reads again.
import { useEffect, useState } from 'react'
import { failureReason } from '../../shared/ipc/channels'
import type { OwnerMarkLook } from '../../shared/ipc/pr-inbox'
import { invoke } from '../ipc'

export interface VerificationChangeProps {
  projectId: string
  repo: string
  number: number
  /** The head the inbox read: a new one reads the strip again. */
  head: string | null
  /** Why this screen may not act (a Linked machine); non-null — nothing is read or offered. */
  readOnly: string | null
}

/** What one look answered, for the PR and head of `key`: a look of another PR or head is not shown. */
interface Answer {
  key: string
  look: OwnerMarkLook | null
  error: string | null
  note: string | null
}

export function VerificationChange({ projectId, repo, number, head, readOnly }: VerificationChangeProps) {
  const key = `${projectId} ${repo}#${String(number)} ${head ?? ''}`
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (readOnly !== null) return
    let current = true
    void invoke('prInbox.verification', { projectId, repo, number }).then((result) => {
      if (!current) return
      setAnswer(result.ok ? { key, look: result.value, error: null, note: null } : { key, look: null, error: failureReason('prInbox.verification', result.error), note: null })
    })
    return () => {
      current = false
    }
  }, [key, projectId, repo, number, readOnly])
  if (readOnly !== null || answer === null || answer.key !== key) return null
  const { look, error, note } = answer
  if (error !== null || typeof look?.error === 'string')
    return (
      <p className="w-pr-inbox-muted" data-testid="pr-inbox-verification-error">
        Verification paths could not be read: {error ?? look?.error}
      </p>
    )
  if (look === null || look.needed !== true || typeof look.head !== 'string') return null
  const shown = look.head
  const allow = (): void => {
    if (running) return
    setRunning(true)
    setAnswer({ ...answer, note: null })
    void invoke('prInbox.allowVerification', { projectId, repo, number, head: shown })
      .then((result) => {
        if (!result.ok) return setAnswer({ ...answer, note: failureReason('prInbox.allowVerification', result.error) })
        const said = result.value.outcome === 'refused' || result.value.outcome === 'failed' ? result.value.reason : null
        setAnswer({ ...answer, look: result.value.look, note: said })
      })
      .finally(() => setRunning(false))
  }
  return (
    <div className="w-pr-inbox-next" data-testid="pr-inbox-verification" data-tone="review">
      <span className="w-pr-inbox-next__text">
        {look.lines.map((line) => (
          <span key={line} data-testid="pr-inbox-verification-line">
            Verification paths: {line}
          </span>
        ))}
        {look.allowed ? (
          <span className="w-pr-inbox-muted" data-testid="pr-inbox-verification-allowed">
            Allowed: the commit status owner is on {shown.slice(0, 8)}, and land may merge it
          </span>
        ) : null}
        {note !== null ? (
          <span role="alert" data-testid="pr-inbox-verification-note">
            {note}
          </span>
        ) : null}
      </span>
      {look.allowed ? null : (
        <button
          type="button"
          className="w-pr-inbox-button w-pr-inbox-button--primary"
          data-testid="pr-inbox-allow-verification"
          disabled={running}
          title={`Writes the commit status owner on ${shown.slice(0, 8)}: land then merges this PR`}
          onClick={allow}
        >
          Allow verification change
        </button>
      )}
    </div>
  )
}
