// The Story view (Epic worfy-code-stories, ticket 09): a Code story over the whole main area, beside Run history,
// in the presentation «Stories» — variant B of docs/product/code-stories/prototype-story-ui-variants.html, the
// owner's decision 26. One screen at a time; over it the bar of segments, one per screen, the screens already seen
// marked; a click on the right half of the screen or → goes on, on the left half or ← goes back. A wide window puts
// the code on the left and the text on the right, a narrow one (under NARROW_WIDTH) one column, text first. An
// Epic story has its chapters over the segments: Start, a ring per PR of the Epic, Seams between tickets, Summary
// and Check, then Check yourself when the story has questions. Esc goes back to the Canvas.
//
// What a screen shows is the story's own words, in its language: the field labels, the frame titles and "not
// recorded" come from labels.json, and "not recorded" is shown as it is. The words of the view itself are English.
// The code of a fragment comes through `codeOf` (open.ts): the view reads no file and no git.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import {
  notRecorded,
  seamsStepNumber,
  storyLabels,
  type Story,
  type StoryChapter,
  type StoryFragment,
  type StoryHandoff,
  type StoryLabels,
  type StoryLanguage,
  type StoryQuestion,
  type StoryStep,
} from '../../shared/stories/schema'
import { Markdown } from '../markdown/Markdown'
import { setView, useNavigation } from '../session/navigation'
import { Chip } from '../theme/Chip'
import { Tab, TabList, TabPanel, Tabs } from '../theme/kit/Tabs'
import { layerOf, openLayers } from '../theme/open-layers'
import { JunctionsDiagram } from './JunctionsDiagram'
import { useStoryView, type FragmentCode, type FragmentCodeSource } from './open'
import './stories.css'

/** Under this width of the view the code goes under the text, in one column (the prototype's 760 px). */
const NARROW_WIDTH = 760

/** One screen of the story. */
type Screen =
  | { kind: 'step'; step: StoryStep; number: number; head: string | null; chapter: StoryChapter | null }
  | { kind: 'start'; text: string; requirement: string }
  | { kind: 'not-ready'; chapter: StoryChapter }
  | { kind: 'seams'; number: number; text: string; handoffs: readonly StoryHandoff[] }
  | { kind: 'summary'; text: string }
  | { kind: 'check'; text: string }
  | { kind: 'check-yourself'; questions: readonly StoryQuestion[] }

/** A chapter of an Epic story over the segments: its ring, its name and the screens it holds. */
interface Chapter {
  id: string
  ring: string
  label: string
  title: string
  from: number
  to: number
  ready: boolean
}

/** The screens of a story in order, and the chapters of an Epic story (none for the story of a PR). */
function screensOf(story: Story): { screens: Screen[]; chapters: Chapter[] } {
  const labels = storyLabels(story.header.language)
  const screens: Screen[] = []
  const chapters: Chapter[] = []
  const chapter = (id: string, ring: string, label: string, title: string, add: () => void, ready = true) => {
    const from = screens.length
    add()
    chapters.push({ id, ring, label, title, from, to: screens.length - 1, ready })
  }
  if (story.kind === 'pr') {
    story.steps.forEach((step, index) => screens.push({ kind: 'step', step, number: index + 1, head: story.header.commit, chapter: null }))
  } else {
    let number = 0
    chapter('start', '!', labels.start, labels.start, () => screens.push({ kind: 'start', text: story.start.text, requirement: story.start.requirement }))
    for (const each of story.chapters) {
      const name = each.pr === null ? 'PR -' : `#${String(each.pr)}`
      chapter(
        `ticket-${each.ticket}`,
        each.ticket,
        name,
        `${each.pr === null ? 'PR -' : `PR #${String(each.pr)}`} · ${each.ticket} — ${each.title}`,
        () => {
          if (!each.ready) screens.push({ kind: 'not-ready', chapter: each })
          else for (const step of each.steps) screens.push({ kind: 'step', step, number: (number += 1), head: each.head, chapter: each })
        },
        each.ready,
      )
    }
    chapter('seams', '⇄', labels.seams, labels.seams, () => screens.push({ kind: 'seams', number: seamsStepNumber(story), text: story.seams.text, handoffs: story.seams.handoffs }))
    chapter('summary', '✓', labels.summary, labels.summary, () => screens.push({ kind: 'summary', text: story.summary }))
    chapter('check', '✓', labels.check, labels.check, () => screens.push({ kind: 'check', text: story.check }))
  }
  if (story.checkYourself.length > 0) {
    const add = () => screens.push({ kind: 'check-yourself', questions: story.checkYourself })
    if (story.kind === 'epic') chapter('check-yourself', '?', labels.checkYourself, labels.checkYourself, add)
    else add()
  }
  return { screens, chapters }
}

/** What a segment and the meta line call a screen. */
function screenName(screen: Screen, labels: StoryLabels): string {
  switch (screen.kind) {
    case 'step':
      return `${String(screen.number)}. ${screen.step.kind === 'code' ? screen.step.title : labels[screen.step.frame]}`
    case 'start':
      return labels.start
    case 'not-ready':
      return `${screen.chapter.ticket} — ${screen.chapter.title}`
    case 'seams':
      return `${String(screen.number)}. ${labels.seams}`
    case 'summary':
      return labels.summary
    case 'check':
      return labels.check
    case 'check-yourself':
      return labels.checkYourself
  }
}

/** A fence longer than any run of backticks in the code, so no line of it closes the block. */
function fenced(code: string, head: string): string {
  const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((match) => match[0].length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${head}\n${code}\n${fence}`
}

/** The fragment as a ```story block of the Markdown renderer: line numbers from its first line, its key lines. */
const storyCodeMarkdown = (shown: FragmentCode): string => fenced(shown.code, `story from=${String(shown.startLine)} key=${shown.keyLines.join(',')}`)

interface Context {
  language: StoryLanguage
  labels: StoryLabels
  missing: string
  codeOf: FragmentCodeSource
  projectId: string | undefined
  storyDir: string | undefined
}

/** A field of the story: "not recorded" as it is, anything else as Markdown. */
function Value({ text, context }: { text: string; context: Context }) {
  if (text.trim() === context.missing) return <p className="w-story__missing">{text}</p>
  return <Markdown text={text} projectId={context.storyDir === undefined ? undefined : context.projectId} baseDir={context.storyDir} />
}

/** The code of one fragment on the dark card: its path and lines over it, the lines from `codeOf`. */
function FragmentBlock({ fragment, head, context }: { fragment: StoryFragment; head: string | null; context: Context }) {
  const [shown, setShown] = useState<{ code: FragmentCode } | { error: string } | null>(null)
  useEffect(() => {
    let live = true
    context.codeOf(fragment, head).then(
      (code) => {
        if (live) setShown({ code })
      },
      (error: unknown) => {
        if (live) setShown({ error: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      live = false
    }
  }, [context, fragment, head])
  const slash = fragment.path.lastIndexOf('/')
  const code = shown === null ? null : 'code' in shown ? shown.code : { code: fragment.code, startLine: fragment.startLine, keyLines: fragment.keyLines, fromHead: true }
  const lines = code === null ? `${String(fragment.startLine)}–${String(fragment.endLine)}` : `${String(code.startLine)}–${String(code.startLine + code.code.split('\n').length - 1)}`
  return (
    <div className="w-story-code" data-testid="story-code" data-path={fragment.path}>
      <div className="w-story-code__head">
        <span className="w-story-code__path">
          {fragment.path.slice(0, slash + 1)}
          <b>{fragment.path.slice(slash + 1)}</b>
          <span className="w-story-code__lines">:{lines}</span>
        </span>
      </div>
      {shown !== null && 'error' in shown ? (
        <p className="w-story-code__note" role="status">
          The code could not be read ({shown.error}): shown as the story quotes it.
        </p>
      ) : code?.fromHead === true ? (
        <p className="w-story-code__note">The code of the PR head: the main branch no longer holds it in this form.</p>
      ) : null}
      {code === null ? <p className="w-story-code__note">Reading the code…</p> : <Markdown text={storyCodeMarkdown(code)} story />}
    </div>
  )
}

/** The fields of a code step after its lead, one tab each, as the prototype's row of details. */
function FieldTabs({ step, context }: { step: Extract<StoryStep, { kind: 'code' }>; context: Context }) {
  const fields = [
    { key: 'whyHere', label: context.labels.whyHere, text: step.whyHere },
    { key: 'withoutIt', label: context.labels.withoutIt, text: step.withoutIt },
    { key: 'requirement', label: context.labels.requirement, text: step.requirement },
    { key: 'risks', label: context.labels.risks, text: step.risks },
  ] as const
  const [tab, setTab] = useState<string>(fields[0].key)
  return (
    <Tabs value={tab} onValueChange={setTab} className="w-story__fields">
      <TabList className="w-story__tabs" aria-label="Fields of the step">
        {fields.map((field) => (
          <Tab key={field.key} value={field.key} className="w-story__tab" data-testid={`story-field-${field.key}`}>
            {field.label}
          </Tab>
        ))}
      </TabList>
      {fields.map((field) => (
        <TabPanel key={field.key} value={field.key} className="w-story__panel" data-testid="story-field-panel">
          <Value text={field.text} context={context} />
        </TabPanel>
      ))}
    </Tabs>
  )
}

/** The small caption over a field's text: the story's own label. */
const Caption = ({ children }: { children: ReactNode }) => <div className="w-story__caption">{children}</div>

/** The row over the title: what kind of screen this is, and the number of the step. */
function Kicker({ label, number, chapter }: { label: string; number?: number | undefined; chapter?: StoryChapter | null | undefined }) {
  return (
    <div className="w-story__kicker">
      <Chip variant="neutral" icon={null} label={label} className="w-story__role" />
      {chapter !== null && chapter !== undefined ? (
        <span className="w-story__chapter">
          {chapter.pr === null ? 'PR -' : `PR #${String(chapter.pr)}`} · Ticket {chapter.ticket}
        </span>
      ) : null}
      {number !== undefined ? <span>Step {number}</span> : null}
    </div>
  )
}

/** One screen: the head row, the text and, for a step that quotes code, the code. */
function ScreenView({ screen, context, narrow }: { screen: Screen; context: Context; narrow: boolean }) {
  const { labels } = context
  let kicker: ReactNode
  let title: string
  let text: ReactNode
  let fragments: { fragments: readonly StoryFragment[]; head: string | null } | null = null
  switch (screen.kind) {
    case 'step': {
      const { step } = screen
      if (step.kind === 'code') {
        kicker = <Kicker label="Code" number={screen.number} chapter={screen.chapter} />
        title = step.title
        text = (
          <>
            <div className="w-story__lead">
              <Caption>{labels.whatItDoes}</Caption>
              <Value text={step.whatItDoes} context={context} />
            </div>
            <FieldTabs step={step} context={context} />
          </>
        )
        fragments = { fragments: [step.fragment], head: screen.head }
      } else {
        kicker = <Kicker label={labels[step.frame]} number={screen.number} chapter={screen.chapter} />
        title = labels[step.frame]
        text = (
          <>
            <div className="w-story__lead">
              <Value text={step.text} context={context} />
            </div>
            {step.requirement !== null ? (
              <div className="w-story__field">
                <Caption>{labels.requirement}</Caption>
                <Value text={step.requirement} context={context} />
              </div>
            ) : null}
          </>
        )
        // A frame step quotes no fragment; only "What review found and what remains" may (TICKETS.md, "Code story").
        if (step.frame === 'review' && step.fragments.length > 0) fragments = { fragments: step.fragments, head: screen.head }
      }
      break
    }
    case 'start':
      kicker = <Kicker label={labels.start} />
      title = labels.start
      text = (
        <>
          <div className="w-story__lead">
            <Value text={screen.text} context={context} />
          </div>
          <div className="w-story__field">
            <Caption>{labels.requirement}</Caption>
            <Value text={screen.requirement} context={context} />
          </div>
        </>
      )
      break
    case 'not-ready':
      kicker = <Kicker label="Not ready" chapter={screen.chapter} />
      title = screen.chapter.title
      text = (
        <div className="w-story__lead">
          <Caption>Ready: no</Caption>
          <Value text={screen.chapter.why ?? context.missing} context={context} />
        </div>
      )
      break
    case 'seams':
      kicker = <Kicker label={labels.seams} number={screen.number} />
      title = labels.seams
      text = (
        <>
          <JunctionsDiagram handoffs={screen.handoffs} language={context.language} />
          <div className="w-story__lead">
            <Value text={screen.text} context={context} />
          </div>
          {screen.handoffs.length > 0 ? (
            <ul className="w-story__handoffs">
              {screen.handoffs.map((handoff, index) => (
                <li key={index} data-done={handoff.done ? 'yes' : 'no'}>
                  <span className="w-story__handoff-route">
                    {handoff.from} → {handoff.to}
                  </span>{' '}
                  <Markdown text={handoff.what} />
                  {handoff.done ? (
                    <span className="w-story__handoff-done">done</span>
                  ) : (
                    <span className="w-story__handoff-dropped">
                      dropped — <Markdown text={handoff.why ?? context.missing} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )
      break
    case 'summary':
    case 'check':
      kicker = <Kicker label={labels[screen.kind]} />
      title = labels[screen.kind]
      text = (
        <div className="w-story__lead">
          <Value text={screen.text} context={context} />
        </div>
      )
      break
    case 'check-yourself':
      kicker = <Kicker label="Optional" />
      title = labels.checkYourself
      text = (
        <>
          <p className="w-story__intro">Nothing depends on the answers.</p>
          <ol className="w-story__questions">
            {screen.questions.map((question, index) => (
              <li key={index}>
                <Markdown text={question.question} />
              </li>
            ))}
          </ol>
        </>
      )
      break
  }
  const code =
    fragments === null ? null : (
      <div className="w-story__code" data-testid="story-code-column">
        {fragments.fragments.map((fragment, index) => (
          <FragmentBlock key={`${String(index)}:${fragment.path}:${String(fragment.startLine)}`} fragment={fragment} head={fragments.head} context={context} />
        ))}
      </div>
    )
  const prose = (
    <div className="w-story__text" data-testid="story-text-column">
      {text}
    </div>
  )
  return (
    <article className={code === null ? 'w-story__screen w-story__screen--prose' : 'w-story__screen'} aria-label={screenName(screen, labels)} data-testid="story-screen" data-kind={screen.kind}>
      <div className="w-story__headrow">
        {kicker}
        <h2 className="w-story__title">{title}</h2>
      </div>
      {/* Wide: the code on the left, the text on the right. Narrow: one column, the text first. */}
      {narrow ? (
        <>
          {prose}
          {code}
        </>
      ) : (
        <>
          {code}
          {prose}
        </>
      )}
    </article>
  )
}

/** The glyph of an edge button: a stroke chevron, as the icons of the window draw them. */
const chevron = (path: string) => (
  <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
)

/** Whether a key press belongs to something else on the page: a field, a list of tabs, an open layer. */
function takenElsewhere(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return true
  const target = event.target instanceof Element ? event.target : null
  if (layerOf(target) !== null || target?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="tablist"]')) return true
  // Only one on screen: the hidden views (AppShell keeps them mounted) may hold a dialog of their own.
  return openLayers().length > 0
}

/** Whether a click landed on something with a click of its own, or on the code or the diagram: it does not turn the screen. */
const CLICK_OWNERS = 'a, button, input, textarea, select, label, [role="tab"], [role="tabpanel"], .w-story-code, .w-story-seams'

export interface StoryViewProps {
  story: Story
  codeOf: FragmentCodeSource
  projectId?: string | undefined
  storyDir?: string | undefined
  /** Whether the view is on screen: only then do the arrow keys turn its screens. */
  active?: boolean
}

export function StoryView({ story, codeOf, projectId, storyDir, active = true }: StoryViewProps) {
  const labels = storyLabels(story.header.language)
  const [{ screens, chapters }] = useState(() => screensOf(story))
  const [context] = useState<Context>(() => ({ language: story.header.language, labels, missing: notRecorded(story.header.language), codeOf, projectId, storyDir }))
  const [index, setIndex] = useState(0)
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set([0]))
  const [narrow, setNarrow] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  const go = (next: number) => {
    if (next < 0 || next >= screens.length) return
    setIndex(next)
    setSeen((before) => new Set(before).add(next))
  }
  const latestGo = useRef(go)
  useLayoutEffect(() => {
    latestGo.current = go
  })

  // One column under NARROW_WIDTH. A hidden view measures 0 wide: that is no width, and changes nothing.
  useLayoutEffect(() => {
    const element = root.current
    if (element === null) return
    const measure = (width: number) => {
      if (width > 0) setNarrow(width < NARROW_WIDTH)
    }
    measure(element.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) measure(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // → and ← turn the screens while the view is on screen.
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') || takenElsewhere(event)) return
      event.preventDefault()
      const at = Number(root.current?.dataset.index ?? 0)
      latestGo.current(event.key === 'ArrowRight' ? at + 1 : at - 1)
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [active])

  // A click on the right half goes on, on the left half back; a click that selected text, or that something on the
  // screen takes, does not. The keyboard has the arrows and the two edge buttons for the same.
  const onStageClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest(CLICK_OWNERS)) return
    const selection = globalThis.getSelection?.()
    if (selection !== null && selection !== undefined && !selection.isCollapsed) return
    const box = event.currentTarget.getBoundingClientRect()
    go(event.clientX - box.left < box.width / 2 ? index - 1 : index + 1)
  }

  const screen = screens[index]!
  const kind = story.kind === 'epic' ? `Epic ${story.header.epic}` : story.header.pr === null ? 'Code story' : `PR #${String(story.header.pr)}`
  const name = story.kind === 'epic' ? story.header.epic : story.header.title
  const segment = (at: number) => {
    const state = at === index ? 'current' : seen.has(at) ? 'read' : 'unread'
    return (
      <button
        key={at}
        type="button"
        className={`w-story__segment w-story__segment--${state}`}
        data-testid="story-segment"
        data-state={state}
        aria-label={screenName(screens[at]!, labels)}
        aria-current={at === index ? 'step' : undefined}
        title={screenName(screens[at]!, labels)}
        onClick={() => go(at)}
      />
    )
  }
  const groups = chapters.length > 0 ? chapters : [{ id: 'all', from: 0, to: screens.length - 1 }]

  return (
    <div className="w-story" role="region" data-testid="story-view" data-layout={narrow ? 'narrow' : 'wide'} data-index={index} aria-label="Code story" ref={root} tabIndex={-1}>
      <div className="w-story__top">
        {chapters.length > 0 ? (
          <nav className="w-story__chapters" aria-label="Chapters">
            {chapters.map((chapter) => {
              const current = index >= chapter.from && index <= chapter.to
              let read = 0
              for (let at = chapter.from; at <= chapter.to; at += 1) if (seen.has(at) && at !== index) read += 1
              const share = Math.round((100 * (current ? read + 1 : read)) / (chapter.to - chapter.from + 1))
              return (
                <button
                  key={chapter.id}
                  type="button"
                  className={`w-story__chapter-button${current ? ' w-story__chapter-button--current' : ''}${chapter.ready ? '' : ' w-story__chapter-button--not-ready'}`}
                  data-testid="story-chapter"
                  data-chapter={chapter.id}
                  aria-current={current ? 'true' : undefined}
                  title={chapter.title}
                  onClick={() => go(chapter.from)}
                >
                  <span className="w-story__ring" style={{ '--share': `${String(share)}%` } as CSSProperties} aria-hidden="true">
                    <span>{chapter.ring}</span>
                  </span>
                  <span className="w-story__chapter-label">{chapter.label}</span>
                </button>
              )
            })}
          </nav>
        ) : null}
        <nav className="w-story__segments" aria-label="Screens">
          {groups.map((group) => (
            <div key={group.id} className="w-story__segment-group" style={{ flexGrow: group.to - group.from + 1 }}>
              {Array.from({ length: group.to - group.from + 1 }, (_, offset) => segment(group.from + offset))}
            </div>
          ))}
        </nav>
        <div className="w-story__meta">
          <Chip variant="neutral" icon={null} label={kind} />
          <span className="w-story__name">{name}</span>
          <b data-testid="story-position">
            {index + 1} of {screens.length}
          </b>
          <span className="w-story__spacer" />
          <span className="w-story__hint">
            <kbd>←</kbd> <kbd>→</kbd> · <kbd>Esc</kbd> Canvas
          </span>
        </div>
      </div>
      {/* The arrows and the edge buttons do with the keyboard what a click on either half does. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="w-story__stage" data-testid="story-stage" onClick={onStageClick}>
        <button type="button" className="w-story__edge w-story__edge--previous" aria-label="Previous screen" disabled={index === 0} onClick={() => go(index - 1)}>
          {chevron('M10 3L5 8l5 5')}
        </button>
        <ScreenView key={index} screen={screen} context={context} narrow={narrow} />
        <button type="button" className="w-story__edge w-story__edge--next" aria-label="Next screen" disabled={index === screens.length - 1} onClick={() => go(index + 1)}>
          {chevron('M6 3l5 5-5 5')}
        </button>
      </div>
    </div>
  )
}

/**
 * The view as the shell mounts it (AppShell.tsx): the story openStory gave, Esc back to the Canvas, the focus on
 * the view at each opening, and back to the Canvas when another Project is picked in the sidebar.
 */
export function StoryScreen({ activeProjectId }: { activeProjectId?: string | undefined }) {
  const active = useNavigation((state) => state.view === 'story')
  const story = useStoryView((state) => state.story)
  const codeOf = useStoryView((state) => state.codeOf)
  const projectId = useStoryView((state) => state.projectId)
  const storyDir = useStoryView((state) => state.storyDir)
  const opened = useStoryView((state) => state.opened)
  const holder = useRef<HTMLDivElement>(null)
  const focused = useRef(0)
  const lastProject = useRef(activeProjectId)

  // Another Project picked in the sidebar: the story on screen is not its own.
  useEffect(() => {
    const before = lastProject.current
    lastProject.current = activeProjectId
    if (before === activeProjectId) return
    if (useNavigation.getState().view === 'story') setView('canvas')
  }, [activeProjectId])

  // The focus at each opening, so Esc and the arrows work at once.
  useEffect(() => {
    if (!active || opened === focused.current) return
    focused.current = opened
    holder.current?.querySelector<HTMLElement>('[data-testid="story-view"]')?.focus()
  }, [active, opened])

  // Esc goes back to the Canvas, unless something else takes it: an open layer — a dialog, a menu, a Select's list
  // (theme/open-layers.ts) — or a text field. As Run history does (flight-recorder/RunHistoryView.tsx).
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target instanceof Element ? event.target : null
      if (layerOf(target) !== null || target?.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) return
      if (openLayers().length > 0) return
      setView('canvas')
    }
    globalThis.addEventListener('keydown', onKey)
    return () => globalThis.removeEventListener('keydown', onKey)
  }, [active])

  return (
    <div className="w-story-holder" ref={holder}>
      {story === null ? (
        <p className="w-story__empty">No Code story is open. A story opens from an Epic, a Ticket or a pull request.</p>
      ) : (
        <StoryView key={opened} story={story} codeOf={codeOf} projectId={projectId ?? undefined} storyDir={storyDir} active={active} />
      )}
    </div>
  )
}
