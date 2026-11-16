import type { SlotProps } from '../badges'
import { openStoryFile, ticketStoryPath } from '../../stories/open'
import { useWorkflow } from '../../workflow/useWorkflow'
import { ActionButton } from './action-button'

// "Code story" on a Ticket card (worfy-code-stories ticket 10, decision 20), right of "Open PR" (OpenPr.tsx): opens the Code
// story of the Ticket's PR, `stories/<NN>-<slug>.md` of its Epic, in the Story view (stories/open.ts). The implementer
// writes that file in the PR itself (decision 7), so it is there once the PR is merged. A Ticket with a PR (its `PR: #N`
// line) or done, and no story of it, has the button inactive with the reason; a Ticket with neither has none. Reading
// changes nothing, so a read-only screen has it active too.

export const order = 35

/** The tooltip of "Code story" on a Ticket without the story of its PR. */
const noTicketStoryTitle = (ref: string, nn: string): string => `No Code story of the PR of ${ref}: the implementer writes stories/${nn}-<slug>.md with the PR`

function TicketStoryButton({ projectId, root, ticket }: Extract<SlotProps['subject'], { kind: 'ticket' }>) {
  // The stories are the Epic's: the model lists them with the Epic, not with the Ticket.
  const { model } = useWorkflow(root)
  const path = ticketStoryPath(
    model?.epics.find((epic) => epic.epic === ticket.epic),
    ticket.num,
  )
  if (path === null && ticket.state !== 'done' && (ticket.pr ?? null) === null) return null
  const nn = String(ticket.num).padStart(2, '0')
  const ref = `${ticket.epic}/${nn}`
  return (
    <ActionButton
      label="Code story"
      testId="action-ticket-story"
      enabled={path !== null}
      title={path === null ? noTicketStoryTitle(ref, nn) : `Open the Code story of the PR of ${ref}`}
      run={() => (path === null ? Promise.resolve(undefined) : openStoryFile(projectId, path))}
    />
  )
}

export default function TicketStory({ subject }: SlotProps) {
  return subject.kind === 'ticket' ? <TicketStoryButton {...subject} /> : null
}
