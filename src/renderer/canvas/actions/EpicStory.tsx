import type { SlotProps } from '../badges'
import { epicStoryPath, openStoryFile } from '../../stories/open'
import { ActionButton } from './action-button'

// "Story" on an Epic frame (worfy-code-stories ticket 10, decision 20), right of the archived Sessions of the Epic
// (EpicSessionHistory.tsx): opens the Code story of the Epic, its `story.md`, in the Story view (stories/open.ts). The
// Orchestrator writes that file when the last PR of the Epic is merged (decision 2); until then the button is inactive
// and its tooltip says so — ticket 11 makes it build the story instead. Reading changes nothing, so a read-only screen
// has it active too. The "⋯" menu of the Epic (AutopilotAction.tsx) has the same entry.

export const order = 45

/** The tooltip of "Story" on an Epic without story.md. */
const noEpicStoryTitle = (epic: string): string => `No Code story of ${epic} yet: it is written when the last PR of the Epic is merged`

function EpicStoryButton({ projectId, epic }: Extract<SlotProps['subject'], { kind: 'epic' }>) {
  const path = epicStoryPath(epic)
  return (
    <ActionButton
      label="Story"
      testId="action-epic-story"
      enabled={path !== null}
      title={path === null ? noEpicStoryTitle(epic.epic) : `Open the Code story of ${epic.epic}`}
      run={() => (path === null ? Promise.resolve(undefined) : openStoryFile(projectId, path))}
    />
  )
}

export default function EpicStory({ subject }: SlotProps) {
  return subject.kind === 'epic' ? <EpicStoryButton {...subject} /> : null
}
