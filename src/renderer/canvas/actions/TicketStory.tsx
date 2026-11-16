import { repoFactsOf } from '../../../shared/workflow/types'
import type { SlotProps } from '../badges'
import { useReadOnly } from '../../projects/useProjects'
import { StoryBuildButton } from '../../stories/StoryBuildButton'
import { openStoryFile, ticketStoryPath } from '../../stories/open'
import { useWorkflow } from '../../workflow/useWorkflow'
import { ActionButton } from './action-button'

// "Code story" on a Ticket card (worfy-code-stories ticket 10, decision 20), right of "Open PR" (OpenPr.tsx): opens the Code
// story of the Ticket's PR, `stories/<NN>-<slug>.md` of its Epic, in the Story view (stories/open.ts). The implementer
// writes that file in the PR itself (decision 7), so it is there once the PR is merged. A Ticket with a PR (its `PR: #N`
// line) and no story of it builds one by the button (ticket 11, decision 6): main reads the PR's diff, its text, the
// Ticket and the verdicts, the progress bar lies over the card from the button's place, and a story kept before opens
// without a request. The PR is read in the repository its `PR: <repo>#N` line names (a Ticket over several
// repositories); a bare `PR: #N` is the Project's first repository's. A done Ticket with no PR line has the button inactive with the reason; a Ticket with neither has
// none. Reading changes nothing, so a read-only screen opens the file; the build writes the Project's data, so it is
// inactive there.

export const order = 35

/** The tooltip of "Code story" on a done Ticket that names no PR. */
const noPrTitle = (ref: string): string => `No Code story of ${ref}: the Ticket names no PR to build one from`

function TicketStoryButton({ projectId, root, ticket }: Extract<SlotProps['subject'], { kind: 'ticket' }>) {
  // The stories are the Epic's: the model lists them with the Epic, not with the Ticket.
  const { model } = useWorkflow(root)
  const readOnly = useReadOnly()
  const path = ticketStoryPath(
    model?.epics.find((epic) => epic.epic === ticket.epic),
    ticket.num,
  )
  // The PR the Ticket's `PR:` line names, with its repository; the first of several when none is `ticket.pr`.
  const prs = repoFactsOf(ticket).prs
  const prRef = prs.find((one) => one.number === ticket.pr) ?? prs[0] ?? null
  const pr = prRef?.number ?? null
  if (path === null && ticket.state !== 'done' && pr === null) return null
  const nn = String(ticket.num).padStart(2, '0')
  const ref = `${ticket.epic}/${nn}`
  if (path === null && prRef !== null) {
    const which = prRef.repo === null ? `PR #${String(prRef.number)}` : `PR ${prRef.repo}#${String(prRef.number)}`
    return (
      <StoryBuildButton
        projectId={projectId}
        target={{ kind: 'pr', repo: prRef.repo, number: prRef.number }}
        title={`Build the Code story of ${which} of ${ref}: it has no story file`}
        testId="action-ticket-story"
        className="w-action nodrag"
        floating
        readOnly={readOnly}
      />
    )
  }
  return (
    <ActionButton
      label="Code story"
      testId="action-ticket-story"
      enabled={path !== null}
      title={path === null ? noPrTitle(ref) : `Open the Code story of the PR of ${ref}`}
      run={() => (path === null ? Promise.resolve(undefined) : openStoryFile(projectId, path))}
    />
  )
}

export default function TicketStory({ subject }: SlotProps) {
  return subject.kind === 'ticket' ? <TicketStoryButton {...subject} /> : null
}
