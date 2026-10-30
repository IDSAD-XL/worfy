// The hints of the demo Ticket's Stages (worfy-onboarding ticket 09; spec, decision 10): one short
// line per concept the demo shows, given while the demo Ticket stands on the Stage it explains. The
// section of Getting started (shell/sidebar/GettingStartedSection.tsx) shows the hint as a line under
// its current step and once as an `info` toast of the Demo project; main records which hints were
// shown (`gettingStarted.hintSeen`). Texts are those of the spec, section "Texts (draft)".
import { DEMO_TICKET_REF, type DemoRecord, type GettingStartedHint, type GettingStartedSnapshot } from '../../shared/ipc/getting-started'
import type { PipelineSnapshot } from '../../shared/ipc/pipeline'

export const HINT_TEXTS: Readonly<Record<GettingStartedHint, string>> = {
  'epic-ticket': 'An Epic is a goal; a Ticket is one piece of work in it. Both are files in the project, under .scratch/.',
  implementing: 'Implementer started in its own worktree — a separate checkout, so main stays untouched.',
  'agent-review': "The reviewer started. It reads the change and runs the project's checks itself.",
  rework: 'The reviewer found a problem — this is the rework round. The implementer fixes it on the same branch.',
  'gate-merge': "Review passed. The Orchestrator runs the Gate — the project's full checks — and merges.",
  done: 'Merged. The ticket is done.',
}

export interface StageHint {
  id: GettingStartedHint
  text: string
}

export interface StageHintInput {
  /** The Demo project's record; no demo, no hint. */
  demo: Pick<DemoRecord, 'path'> | null
  /** The steps marked so far. */
  steps: GettingStartedSnapshot['steps']
  /** The Stages of a Project (usePipeline); only the demo's own give a hint. */
  pipeline: PipelineSnapshot | undefined
}

/**
 * The hint for the demo Ticket's Stage now, or null: no demo, the Stages of another Project, no demo
 * Ticket in them, or a Stage the demo has no hint for. The Epic and Ticket hint belongs to step 3, Meet
 * the Orchestrator: it is given once the Orchestrator has answered (step 3 marked), while the Ticket
 * still waits in Queued and step 4 is not marked. Implementing after a `failure` mark (`rework`)
 * gives the rework round's hint, not the first Implementing's.
 */
export function stageHint({ demo, steps, pipeline }: StageHintInput): StageHint | null {
  if (demo === null || pipeline === undefined || pipeline.root !== demo.path) return null
  const ticket = pipeline.tickets.find((each) => each.epic === DEMO_TICKET_REF.epic && each.num === DEMO_TICKET_REF.num)
  if (ticket === undefined) return null
  const id = hintOf(ticket.kind, ticket.rework, steps['3'] !== undefined && steps['4'] === undefined)
  return id === null ? null : { id, text: HINT_TEXTS[id] }
}

function hintOf(kind: PipelineSnapshot['tickets'][number]['kind'], rework: boolean, betweenSteps3And4: boolean): GettingStartedHint | null {
  switch (kind) {
    case 'queued':
      return betweenSteps3And4 ? 'epic-ticket' : null
    case 'implementing':
      return rework ? 'rework' : 'implementing'
    case 'agent-review':
      return 'agent-review'
    case 'gate-merge':
      return 'gate-merge'
    case 'done':
      return 'done'
    default:
      return null
  }
}
