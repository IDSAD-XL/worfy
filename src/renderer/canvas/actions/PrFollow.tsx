import type { ReactElement } from 'react'
import type { ActionState } from '../../../shared/actions/render-template'
import { failureReason } from '../../../shared/ipc/channels'
import { ACTION_LABELS } from '../../../shared/projects/action-templates'
import { invoke } from '../../ipc'
import { usePrInbox } from '../../pr-inbox/usePrInbox'
import { useWorkflow } from '../../workflow/useWorkflow'
import type { SlotProps } from '../badges'
import { useCanvasStore } from '../canvas-store'
import { sessionSpot, spotInputs } from '../session-spot'
import { ActionButton } from './action-button'
import { ActionMenu } from './action-menu'
import { usePrFollowState } from './gates'
import { prFollowChoices, prFollowTitle, type PrFollowChoice } from './pr-follow-choices'

// "Resolve conflicts", "Fix checks" and "Address comments" on a Ticket (worfy-pr-follow ticket 05), for the PRs of the
// Ticket in the Project's PR inbox (prFollowChoices, pr-follow-choices.ts); a Project with `"prInbox": false`, or a
// Ticket whose PR the snapshot does not hold or needs nothing, shows nothing.
//
// One button for the first reason — of the first PR, in the order Resolve conflicts → Fix checks → Address comments
// (prFollowReasons: a PR in conflict runs no CI) — and «▾» beside it with the other reasons. A Ticket over several
// repositories (ADR-0104) gets an item per PR and reason, each naming its PR, as «Open PR» names them. Whether each one
// can run, and its text or the reason why not, is usePrFollowState's (gates.ts): the Pull requests view and the rows
// of the Command palette ask it too, so the three never disagree. A click asks main (`actions.prFollow`), which reads
// the PR again and refuses with a reason the button's or «▾»'s tooltip then shows («… is already starting for
// owner/web#118: …»). A new Session goes next to the Ticket, as Ship ticket's does (`near`, TicketActions.tsx).

export const order = 20

interface Collected {
  projectId: string
  choices: readonly PrFollowChoice[]
  states: readonly ActionState[]
  draw: (states: readonly ActionState[]) => ReactElement
}

// The state of every choice, from usePrFollowState one choice at a time: a component a choice, so the number of hook
// calls of each component never changes however many PRs and reasons the Ticket has.
function Collect(props: Collected): ReactElement {
  return props.states.length === props.choices.length ? props.draw(props.states) : <CollectOne {...props} />
}

function CollectOne({ projectId, choices, states, draw }: Collected): ReactElement {
  const choice = choices[states.length]!
  const state = usePrFollowState(projectId, choice.row, choice.action)
  return <Collect projectId={projectId} choices={choices} states={[...states, state]} draw={draw} />
}

const titleOf = (state: ActionState): string => (state.enabled ? state.text : state.reason)

function TicketPrFollow({ projectId, root, ticket }: Extract<SlotProps['subject'], { kind: 'ticket' }>) {
  const { snapshot } = usePrInbox(projectId)
  const { model } = useWorkflow(root)
  const store = useCanvasStore()
  const choices = prFollowChoices(snapshot, ticket, model?.tickets ?? [ticket])
  if (choices.length === 0) return null
  const several = new Set(choices.map(({ row }) => `${row.repo}#${row.number}`)).size > 1

  const run = ({ row, action }: PrFollowChoice) => async (): Promise<string | undefined> => {
    const { frames, strip } = store ? spotInputs(store.getState().nodeLookup.values()) : { frames: [], strip: undefined }
    const near = sessionSpot({ kind: 'ticket', epic: ticket.epic, num: ticket.num }, frames, strip)
    const result = await invoke('actions.prFollow', { projectId, repo: row.repo, pr: row.number, action, ...(near ? { near } : {}) })
    return result.ok ? undefined : failureReason('actions.prFollow', result.error)
  }

  const draw = (states: readonly ActionState[]): ReactElement => {
    const [first, ...rest] = choices
    const state = states[0]!
    return (
      <>
        <ActionButton label={ACTION_LABELS[first!.action]} testId="action-pr-follow" enabled={state.enabled} title={titleOf(state)} run={run(first!)} />
        {rest.length > 0 ? (
          <ActionMenu
            label="More pull request actions"
            text="▾"
            title="Other actions on the Ticket's pull requests"
            testId="action-pr-follow-more"
            menuLabel="Pull request actions"
            items={rest.map((choice, index) => {
              const each = states[index + 1]!
              return {
                label: several ? prFollowTitle(choice) : ACTION_LABELS[choice.action],
                title: titleOf(each),
                testId: `action-pr-follow-item-${choice.action}-${choice.row.repo}#${choice.row.number}`,
                disabled: !each.enabled,
                run: run(choice),
              }
            })}
          />
        ) : null}
      </>
    )
  }
  return <Collect projectId={projectId} choices={choices} states={[]} draw={draw} />
}

export default function PrFollow({ subject }: SlotProps) {
  return subject.kind === 'ticket' ? <TicketPrFollow {...subject} /> : null
}
