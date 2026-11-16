import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { StoryTarget } from '../../shared/ipc/stories'
import { invoke } from '../ipc'
import { Popover } from '../theme/kit/Popover'
import { openMadeStory } from './open'
import { StoryProgress } from './StoryProgress'
import { useStoryBuild } from './story-build'

/*
 * "Code story" that builds the story when there is none (worfy-code-stories ticket 11; spec, decisions 6, 13, 18, 19):
 * on a PR in Pull requests, on a Ticket card whose PR has no story file, on an Epic frame without story.md. A press asks
 * main (`stories.make`); the progress bar shows while the invisible agent works, and the Story view opens on the story
 * main kept. A story kept before opens at once, with no request. "Rebuild" — shown where `savedKey` is given and main
 * keeps a story under it — builds it again. Leaving the screen while it builds stops the build (story-build.ts).
 *
 * On the Canvas (`floating`) the bar is the kit's Popover drawn into document.body under the button, its right edge on
 * the button's, as the Autopilot "⋯" menu: neither the card (240px, `overflow: hidden`) nor the frame cuts it, the ticket
 * cards (Nodes of their own) do not cover it, and the Canvas's zoom does not scale it. The button stays in its place,
 * inactive while the bar is up. A press outside or the focus elsewhere leaves the bar up; Esc in it, and a switch of
 * the view, stop a build under way (as leaving the screen does) and close a bar that only says why no story came. In
 * Pull requests the bar stands inline, in the button's place. After Close the focus goes back to the button.
 */

export interface StoryBuildButtonProps {
  projectId: string
  target: StoryTarget
  /** The tooltip of the button. */
  title: string
  testId: string
  className: string
  /** The key main keeps the story under (`owner/name#N`, `epic:<name>`): with it, "Rebuild" once one is kept. */
  savedKey?: string
  floating?: boolean
  /** A read-only screen (a Linked machine's Project): the build writes into the Project's data, so it is inactive with this reason. */
  readOnly?: string | null
}

export function StoryBuildButton({ projectId, target, title, testId, className, savedKey, floating = false, readOnly = null }: StoryBuildButtonProps) {
  const { run, make, stop, reset } = useStoryBuild(projectId)
  const [saved, setSaved] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const shown = run.kind !== 'idle' && run.kind !== 'done'
  const wasShown = useRef(false)

  useEffect(() => {
    if (savedKey === undefined) return
    let live = true
    void invoke('stories.saved', { projectId, key: savedKey }).then((result) => {
      if (live) setSaved(result.ok && result.value !== null)
    })
    return () => {
      live = false
    }
  }, [projectId, savedKey])

  useEffect(() => {
    if (run.kind !== 'done') return
    openMadeStory(projectId, run.story, run.key)
    if (savedKey !== undefined && run.key === savedKey) setSaved(true)
    reset()
  }, [run, projectId, savedKey, reset])

  // The bar went (Close, or the story opened): the focus it held goes back to the button, not to the page.
  useEffect(() => {
    if (shown) {
      wasShown.current = true
      return
    }
    if (!wasShown.current) return
    wasShown.current = false
    const active = document.activeElement
    if (active === null || active === document.body) buttonRef.current?.focus()
  }, [shown])

  const button = (label: string, id: string, rebuild: boolean, tip: string, ref?: (element: HTMLButtonElement | null) => void): ReactNode => (
    <button
      ref={ref}
      type="button"
      className={className}
      data-testid={id}
      aria-disabled={readOnly === null && !shown ? 'false' : 'true'}
      title={readOnly ?? tip}
      onClick={() => {
        if (readOnly === null && !shown) void make(target, { rebuild })
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {label}
    </button>
  )
  const setButton = (element: HTMLButtonElement | null) => {
    buttonRef.current = element
  }

  if (floating) {
    return (
      <>
        {button('Code story', testId, false, title, setButton)}
        <Popover
          open={shown}
          onOpenChange={(open) => {
            if (open) return
            if (run.kind === 'running') stop()
            else reset()
          }}
          onDismiss={(reason) => reason === 'view'}
          anchor={buttonRef}
          label="Code story build"
          className="w-story-build-popover"
          testId={`${testId}-progress`}
          side="bottom"
          align="end"
          inNode
          finalFocus={buttonRef}
        >
          <StoryProgress run={run} onStop={stop} onDismiss={reset} />
        </Popover>
      </>
    )
  }
  if (!shown) {
    return (
      <>
        {button('Code story', testId, false, title, setButton)}
        {saved ? button('Rebuild story', `${testId}-rebuild`, true, 'Build the Code story again, in place of the one kept') : null}
      </>
    )
  }
  return (
    <span className="w-story-build nodrag" data-testid={`${testId}-progress`}>
      <StoryProgress run={run} onStop={stop} onDismiss={reset} />
    </span>
  )
}
