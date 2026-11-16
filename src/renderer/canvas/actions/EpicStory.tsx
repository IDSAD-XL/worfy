import type { SlotProps } from '../badges'
import { useReadOnly } from '../../projects/useProjects'
import { StoryBuildButton } from '../../stories/StoryBuildButton'
import { epicStoryPath, openStoryFile } from '../../stories/open'
import { ActionButton } from './action-button'

// "Code story" on an Epic frame (worfy-code-stories ticket 10, decision 20), right of the archived Sessions of the Epic
// (EpicSessionHistory.tsx): opens the Code story of the Epic, its `story.md`, in the Story view (stories/open.ts). The
// Orchestrator writes that file when the last PR of the Epic is merged (decision 2). Until then the button builds the
// story of the Epic so far by the button (ticket 11, decisions 13 and 18): from the stories of its merged PRs, the
// Tickets not ready yet marked; the progress bar lies over the frame from the button's place, and a story kept before
// opens without a request. Reading changes nothing, so a read-only screen opens story.md; the build writes the
// Project's data, so it is inactive there. The "⋯" menu of the Epic (AutopilotAction.tsx) has the same entry for
// story.md.

export const order = 45

function EpicStoryButton({ projectId, epic }: Extract<SlotProps['subject'], { kind: 'epic' }>) {
  const path = epicStoryPath(epic)
  const readOnly = useReadOnly()
  if (path === null) {
    return (
      <StoryBuildButton
        projectId={projectId}
        target={{ kind: 'epic', epic: epic.epic }}
        title={`Build the Code story of ${epic.epic} so far, from the stories of its merged PRs`}
        testId="action-epic-story"
        className="w-action nodrag"
        floating
        readOnly={readOnly}
      />
    )
  }
  return <ActionButton label="Code story" testId="action-epic-story" enabled title={`Open the Code story of ${epic.epic}`} run={() => openStoryFile(projectId, path)} />
}

export default function EpicStory({ subject }: SlotProps) {
  return subject.kind === 'epic' ? <EpicStoryButton {...subject} /> : null
}
