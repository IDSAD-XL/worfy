// The data flow of an Autopilot run (worfy-guide ticket 06), the diagram of the Topic's Under the hood,
// from the section "Data flow" of docs/features/autopilot.md. The button asks main over IPC; the run
// (src/main/autopilot/run.ts) feeds each event to the pure cycle and carries out its effects: "Run
// wave" through the launcher to the Orchestrator's Session, lines to the journal, keep-awake. The
// Session's events and the workflow watch come back to the run, and every new state goes to every
// window as autopilot.changed. Labelled from the texts' `underTheHood.flow.labels`.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { AUTOPILOT_FLOW } from './spec'

export default function Flow(props: SceneProps) {
  return <LivingScene spec={AUTOPILOT_FLOW} {...props} />
}
