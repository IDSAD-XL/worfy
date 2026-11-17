import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { StoryTarget } from '../../shared/ipc/stories'
import { invoke } from '../ipc'
import { useNavigation } from '../session/navigation'
import { Popover } from '../theme/kit/Popover'
import { openMadeStory } from './open'
import { StoryProgress } from './StoryProgress'
import { useStoryBuild } from './story-build'
import { showMadeStoryToast } from './use-story-toasts'

/*
 * "Code story" that builds the story when there is none (worfy-code-stories ticket 11; spec, decisions 6, 13, 18, 19):
 * on a PR in Pull requests, on a Ticket card whose PR has no story file, on an Epic frame without story.md. A press asks
 * main (`stories.make`); the progress bar shows while the invisible agent works, and the Story view opens on the story
 * main kept. A story kept before opens at once, with no request. "Rebuild" — shown where `savedKey` is given and main
 * keeps a story under it — builds it again.
 *
 * A build runs to its end whatever view is open; only Stop ends it (worfy-polish 122). A button that comes back to its
 * PR or Epic — another PR picked and this one again, the Canvas shown again, the window reloaded — takes up the build
 * under way (`follow`, story-build.ts) and shows its bar. A story that comes while the button is out of sight (its view
 * hidden, or the button gone) is not opened over what the person looks at: the window shows the toast "The Code story
 * of … is ready" with "Open" (use-story-toasts.ts).
 *
 * On the Canvas (`floating`) the bar is the kit's Popover drawn into document.body under the button, its right edge on
 * the button's, as the Autopilot "⋯" menu: neither the card (240px, `overflow: hidden`) nor the frame cuts it, the ticket
 * cards (Nodes of their own) do not cover it, and the Canvas's zoom does not scale it. The button stays in its place,
 * inactive while the bar is up. A press outside or the focus elsewhere leaves the bar up; Esc in it, and a switch of
 * the view, close the bar — a build under way goes on, its bar comes back with the Canvas or on a press of the button —
 * and close a bar that only says why no story came. In Pull requests the bar stands inline, in the button's place. After
 * Close the focus goes back to the button.
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
  const { run, make, follow, stop, reset } = useStoryBuild(projectId)
  const [saved, setSaved] = useState(false)
  // On the Canvas: the bar of a build under way closed by Esc or a switch of the view; the build goes on.
  const [barHidden, setBarHidden] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const shown = run.kind !== 'idle' && run.kind !== 'done'
  const wasShown = useRef(false)
  const view = useNavigation((state) => state.view)
  // The Canvas shown again: a floating button looks for its build anew (it may have been started elsewhere) and its bar comes back.
  const canvasShown = floating && view === 'canvas'
  const targetKey = JSON.stringify(target)

  useEffect(() => {
    if (floating && !canvasShown) return
    setBarHidden(false)
    void follow(JSON.parse(targetKey) as StoryTarget)
  }, [follow, targetKey, floating, canvasShown])

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
    // Out of sight — the view of the button hidden — the story waits in a toast instead of covering what is on screen.
    const button = buttonRef.current
    const outOfSight = button === null || button.closest('[hidden]') !== null
    if (outOfSight && !run.reused && run.key !== undefined) showMadeStoryToast(projectId, run.key, run.story)
    else openMadeStory(projectId, run.story, run.key)
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
      aria-disabled={readOnly === null && (!shown || barHidden) ? 'false' : 'true'}
      title={readOnly ?? (shown && barHidden ? 'Show the progress of the Code story being built' : tip)}
      onClick={() => {
        if (readOnly !== null) return
        setBarHidden(false)
        if (!shown) void make(target, { rebuild })
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
          open={shown && !barHidden}
          onOpenChange={(open) => {
            if (open) return
            // A build under way runs on: only Stop in the bar ends it (worfy-polish 122).
            if (run.kind === 'running') setBarHidden(true)
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
