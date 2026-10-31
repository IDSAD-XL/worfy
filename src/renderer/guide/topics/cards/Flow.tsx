// The data flow of a Card (worfy-guide ticket 15), the diagram of the Topic's Under the hood, from the
// three "Data flow" paragraphs of docs/features/cards.md: create_card and the agent's writes; a file
// change through CardStore and cards.changed to a new iframe, which the worfy-card:// protocol fills;
// a request of window.worfy through the window's bridge to main over IPC. Labelled from the texts'
// `underTheHood.flow.labels`.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { CARDS_FLOW } from './spec'

export default function Flow(props: SceneProps) {
  return <LivingScene spec={CARDS_FLOW} {...props} />
}
