import { changesTitle, hasChangesSubject, openChanges } from '../../changes/open'
import type { SlotProps } from '../badges'
import { ActionButton } from './action-button'

// "Changes" on a Ticket card (worfy-changes-view tickets 03 and 08): opens the Changes view of the Ticket over the whole
// main area — the diff of its worktree or branch against the base (changes/ChangesView.tsx); «← Canvas» and Esc come
// back. Shown on a Ticket with a worktree branch, a `Branch:` line or work on it (changes/open.ts, hasChangesSubject);
// without a count of lines, which is part 2. The view only reads git and changes no Layout, so a read-only screen (a
// Linked machine with Read only) has the button too.
//
// The card's action row may not fit one more button: «Resolve conflicts ▾ Open PR Changes» is 285 px against the 218 px
// of the card. The row wraps, and the layout gives a second line of actions to just the cards this button shows on
// (ACTIONS_LINE and showsChanges of ticket-card.ts): a worktree the checks snapshot names alone shows no button, as
// its card has no room for it.

export const order = 33

function ChangesButton({ projectId, ticket }: Extract<SlotProps['subject'], { kind: 'ticket' }>) {
  if (!hasChangesSubject(ticket)) return null
  const subject = { epic: ticket.epic, num: ticket.num }
  return (
    <ActionButton
      label="Changes"
      testId="action-changes"
      enabled
      title={changesTitle(subject)}
      run={() => {
        openChanges(projectId, subject)
        return Promise.resolve(undefined)
      }}
    />
  )
}

export default function Changes({ subject }: SlotProps) {
  return subject.kind === 'ticket' ? <ChangesButton {...subject} /> : null
}
