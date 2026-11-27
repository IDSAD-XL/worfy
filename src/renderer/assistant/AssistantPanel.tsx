// The body of the Assistant's section (worfy-assistant ticket 14; spec, UI; stories 1, 2, 16, 21–23, 35 and 38), after the
// prototype Card the owner accepted: the status, four tabs — Waits, Summary, Journal, Chat — the line of usage and the
// box to write to the Assistant at any moment. Waits shows what waits on each Linked machine too, read-only (ticket 18).
// While the one offer to turn the Assistant on stands, it heads the body (ticket 16, Offer.tsx); in the conversation the
// card of the first setup of its introduction follows the message that hands it over.
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { AssistantView, JournalRow, WindowItem, WindowProposal } from '../../shared/assistant/window'
import { ErrorBoundary } from '../shell/ErrorBoundary'
import { shortTime } from './format'
import { Icon, Spark } from './icons'
import { OfferCard } from './Offer'
import { openItem } from './open'
import { AssistantWords, GoneCard, ItemCard, LinkedMachine, RateButtons } from './parts'
import { applyChange, dismissProposal, forgetRule, prepareItem, sendMessage, undoChange, useAssistant, type AssistantTab } from './useAssistant'

const TABS: readonly { tab: AssistantTab; label: string }[] = [
  { tab: 'waits', label: 'Waits' },
  { tab: 'summary', label: 'Summary' },
  { tab: 'journal', label: 'Journal' },
  { tab: 'chat', label: 'Chat' },
]

/**
 * The card «before → after» of a change of the settings (ticket 15; story 26): each setting as it is and as it would be.
 * Nothing changes until Apply; Not now dismisses the proposal; once applied, the card says when and offers Undo (ticket
 * 25), which puts the settings back and shows Apply again, as the prototype does. A card applied before Undo existed
 * keeps ticket 15's line.
 */
function ChangeCard({ proposal, change }: { proposal: WindowProposal; change: NonNullable<WindowProposal['change']> }): ReactElement {
  const applied = change.applied !== null
  return (
    <article className={`w-asst-change${applied ? ' w-asst-change--applied' : ''}`} data-testid="assistant-change" data-proposal-id={proposal.id}>
      <div className="w-asst-change__head">
        <Spark />
        <span className="w-asst-change__title">{proposal.title}</span>
        <span className="w-asst-change__hint">before → after</span>
      </div>
      <div className="w-asst-change__why">{proposal.why}</div>
      {change.rows.map((row, index) => (
        // Rows never move within a card, and two may share a label: the place keeps the key apart.
        <div key={`${index}:${row.label}`} className="w-asst-change__row">
          <span className="w-asst-change__label">{row.label}</span>
          <span className="w-asst-change__before">{row.before}</span>
          <span className="w-asst-change__after">{row.after}</span>
        </div>
      ))}
      <div className="w-asst-change__foot">
        {applied ? (
          <>
            <Icon name="check" />
            <span>
              Applied at {shortTime(change.applied ?? 0)}.{change.undoable === true ? null : ' Change it back in Settings → Assistant.'}
            </span>
            <button type="button" className="w-asst-button w-asst-button--ghost" onClick={() => void dismissProposal(proposal.id)}>
              Dismiss
            </button>
            {change.undoable === true ? (
              <button type="button" className="w-asst-button" onClick={() => void undoChange(proposal.id)}>
                <Icon name="undo" />
                Undo
              </button>
            ) : null}
          </>
        ) : (
          <>
            <span className="w-asst-change__note">Nothing changes until you press Apply.</span>
            <button type="button" className="w-asst-button w-asst-button--ghost" onClick={() => void dismissProposal(proposal.id)}>
              Not now
            </button>
            <button type="button" className="w-asst-button w-asst-button--assistant" onClick={() => void applyChange(proposal.id)}>
              <Icon name="check" />
              Apply
            </button>
          </>
        )}
      </div>
    </article>
  )
}

function ProposalCard({ proposal }: { proposal: WindowProposal }): ReactElement {
  if (proposal.change !== null) return <ChangeCard proposal={proposal} change={proposal.change} />
  return (
    <article className="w-asst-item" data-testid="assistant-proposal">
      <div className="w-asst-item__top">
        <span className="w-asst-kind w-asst-kind--assistant">
          <Spark />
        </span>
        <div className="w-asst-item__main">
          <div className="w-asst-item__title">{proposal.title}</div>
          <div className="w-asst-item__why">{proposal.why}</div>
        </div>
        <span className="w-asst-item__since w-mono">{shortTime(proposal.createdAt)}</span>
      </div>
      <div className="w-asst-actions">
        {proposal.prepare !== null ? (
          <button
            type="button"
            className="w-asst-button w-asst-button--assistant"
            data-action="prepare"
            onClick={() => {
              const prepare = proposal.prepare
              if (prepare !== null) useAssistant.setState({ prepare: { title: proposal.title, projectId: prepare.projectId, projectName: prepare.projectName, text: prepare.text, by: prepare.by, itemId: null, proposalId: proposal.id } })
            }}
          >
            <Icon name="doc" />
            Prepare
          </button>
        ) : null}
        <button type="button" className="w-asst-button w-asst-button--ghost" data-action="dismiss" onClick={() => void dismissProposal(proposal.id)}>
          Dismiss
        </button>
        <RateButtons target={{ kind: 'proposal', id: proposal.id }} rating={proposal.rating} />
      </div>
    </article>
  )
}

function Group({ title, items }: { title: string; items: readonly WindowItem[] }): ReactElement | null {
  const focus = useAssistant((state) => state.focus)
  if (items.length === 0) return null
  return (
    <>
      <div className="w-asst-group">
        {title} <span className="w-asst-group__count">{items.length}</span>
      </div>
      {items.map((item) => (
        <ItemCard key={item.id} item={item} focus={focus === item.id} />
      ))}
    </>
  )
}

function Waits({ view }: { view: AssistantView }): ReactElement {
  const gone = useAssistant((state) => state.gone)
  const [hiddenOpen, setHiddenOpen] = useState(false)
  const now = view.items.filter((item) => item.urgent)
  const later = view.items.filter((item) => !item.urgent)
  const shownIds = new Set(view.items.map((item) => item.id))
  const goneNow = gone.filter((each) => !shownIds.has(each.item.id) && view.hidden.some((hidden) => hidden.item.id === each.item.id))
  const summary = view.summary
  return (
    <>
      <button type="button" className="w-asst-banner" onClick={() => useAssistant.setState({ tab: 'summary' })}>
        <span className="w-asst-banner__sun">
          <Icon name="sun" />
        </span>
        <span className="w-asst-banner__text">
          <b>Summary · since {shortTime(summary.since)}</b>
          <span>
            {summary.came} came · {summary.done} done on its own · {summary.waiting} wait for you
          </span>
        </span>
        <Icon name="chevr" size={12} />
      </button>
      <Group title="Needs you now" items={now} />
      <Group title="Waiting" items={later} />
      {view.proposals.length > 0 ? (
        <>
          <div className="w-asst-group">
            Proposals <span className="w-asst-group__count">{view.proposals.length}</span>
          </div>
          {view.proposals.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} />
          ))}
        </>
      ) : null}
      {goneNow.map((each) => (
        <GoneCard key={each.item.id} gone={each} />
      ))}
      <Group title="Snoozed" items={view.snoozed} />
      {view.items.length === 0 && view.proposals.length === 0 ? (
        <div className="w-asst-empty" data-testid="assistant-empty">
          <Spark size={18} />
          <p>Nothing waits for you. I’ll tell you when something does.</p>
        </div>
      ) : null}
      {view.linked.map((machine) => (
        <LinkedMachine key={machine.id} machine={machine} />
      ))}
      {view.hidden.length > 0 ? (
        <div className="w-asst-hidden-line" data-testid="assistant-hidden">
          <Icon name="eyeoff" size={12} />
          {view.hidden.length} hidden by your ratings ·{' '}
          <button type="button" className="w-asst-link" onClick={() => setHiddenOpen(!hiddenOpen)}>
            {hiddenOpen ? 'Hide' : 'Show'}
          </button>
        </div>
      ) : null}
      {hiddenOpen
        ? view.hidden.map(({ item, rule }) => (
            <div key={item.id} className="w-asst-hidden">
              <s>{item.title}</s>
              <span className="w-mono">{rule.text}</span>
              <button type="button" className="w-asst-button" onClick={() => void forgetRule(rule.id)}>
                Show again
              </button>
            </div>
          ))
        : null}
    </>
  )
}

function Summary({ view }: { view: AssistantView }): ReactElement {
  const summary = view.summary
  const first = summary.first.map((id) => view.items.find((item) => item.id === id)).filter((item): item is WindowItem => item !== undefined)
  return (
    <div data-testid="assistant-summary">
      <div className="w-asst-hero">
        <h3>Since {shortTime(summary.since)}</h3>
        <p>
          Over {view.projects === 1 ? 'one Project' : `${view.projects} Projects`} of this machine. worfy counts this itself, without the model.
        </p>
        <div className="w-asst-tiles">
          <div className="w-asst-tile">
            <b>{summary.came}</b>
            <span>came</span>
          </div>
          <div className="w-asst-tile w-asst-tile--assistant">
            <b>{summary.done}</b>
            <span>done on its own</span>
          </div>
          <div className="w-asst-tile w-asst-tile--blocked">
            <b>{summary.stopped}</b>
            <span>{summary.stopped === 1 ? 'Run stopped' : 'Runs stopped'}</span>
          </div>
          <div className="w-asst-tile">
            <b>{summary.waiting}</b>
            <span>wait for you</span>
          </div>
        </div>
      </div>
      {summary.morning !== null ? (
        <div className="w-asst-card">
          <h4>
            <Spark size={12} />
            Morning summary · {shortTime(summary.morning.at)}
          </h4>
          <AssistantWords text={summary.morning.text} />
        </div>
      ) : null}
      {summary.projects.length > 0 ? (
        <div className="w-asst-card">
          <h4>
            <Icon name="folder" size={12} />
            By Project
          </h4>
          {summary.projects.map((project) => (
            <div key={project.projectId ?? 'machine'} className="w-asst-project">
              <span className="w-asst-project__name w-mono">
                <span className="w-asst-dot" data-urgent={project.urgent > 0 ? '' : undefined} />
                {project.name}
              </span>
              <span>
                {project.came} came · {project.waiting} wait for you{project.urgent > 0 ? ` · ${project.urgent} urgent` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {first.length > 0 ? (
        <div className="w-asst-card">
          <h4>
            <Spark size={12} />
            What to take first
          </h4>
          {first.map((item, index) => (
            <div key={item.id} className="w-asst-step">
              <span className="w-asst-step__number">{index + 1}</span>
              <span className="w-asst-step__text">
                {item.title}
                <small>{item.why ?? item.duty?.title ?? item.sourceLabel}</small>
              </span>
              {item.prepare !== null ? (
                <button type="button" className="w-asst-button w-asst-button--assistant" onClick={() => prepareItem(item)}>
                  <Icon name="doc" />
                  Prepare
                </button>
              ) : item.open !== null ? (
                <button type="button" className="w-asst-button" onClick={() => void openItem(item)}>
                  <Icon name="open" />
                  Open
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="w-asst-hidden-line w-asst-hidden-line--end">
        Was this summary useful?
        <RateButtons target={{ kind: 'summary', id: summary.id }} rating={summary.rating} />
      </div>
    </div>
  )
}

type JournalFilter = 'all' | 'own' | 'you'
const FILTERS: readonly { filter: JournalFilter; label: string }[] = [
  { filter: 'all', label: 'All' },
  { filter: 'own', label: 'Done on its own' },
  { filter: 'you', label: 'Your actions' },
]
const WHO: Record<JournalRow['by'], string> = { worfy: 'worfy · no model', assistant: 'Assistant', you: 'You' }

function Journal({ view }: { view: AssistantView }): ReactElement {
  const [filter, setFilter] = useState<JournalFilter>('all')
  const rows = view.journal.filter((row) => filter === 'all' || (filter === 'you' ? row.by === 'you' : row.by !== 'you'))
  const show = (row: JournalRow) => {
    if (row.cause.open) useAssistant.setState({ tab: 'waits', focus: row.cause.itemId })
  }
  return (
    <div data-testid="assistant-journal">
      <div className="w-asst-filters">
        {FILTERS.map((each) => (
          <button key={each.filter} type="button" aria-pressed={filter === each.filter} onClick={() => setFilter(each.filter)}>
            {each.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? <p className="w-asst-empty">Nothing here yet. What Assistant and worfy do on their own shows here, each with the item that caused it.</p> : null}
      {rows.map((row) => (
        <div key={row.id} className="w-asst-journal" data-testid="assistant-journal-row" data-outcome={row.outcome}>
          <span className="w-asst-journal__time w-mono">{shortTime(row.at)}</span>
          <div className="w-asst-journal__text">
            <span className="w-asst-who" data-who={row.by}>
              {WHO[row.by]}
            </span>
            {row.text}
            <div className="w-asst-cause">
              <span>caused by</span>
              <button type="button" className="w-asst-cause__item" disabled={!row.cause.open} title={row.cause.open ? 'Show the item that caused it' : 'That item no longer waits'} onClick={() => show(row)}>
                <Icon name={row.cause.open ? 'chevr' : 'info'} size={12} />
                {row.cause.text}
              </button>
            </div>
          </div>
          <RateButtons target={{ kind: 'journal', id: row.id }} rating={row.rating} />
        </div>
      ))}
    </div>
  )
}

function Chat({ view }: { view: AssistantView }): ReactElement {
  const end = useRef<HTMLDivElement>(null)
  const count = view.conversation.length
  // In braces: Chromium may answer scrollIntoView with a Promise, and React calls what an effect returns (worfy-polish 165).
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [count])
  return (
    <div data-testid="assistant-chat">
      {count === 0 ? <p className="w-asst-empty">Write to Assistant at any moment: to set it up, or to understand worfy. It answers in the language of the Guide.</p> : null}
      {view.conversation.map((message) => {
        if (message.who === 'you') {
          return (
            <div key={message.id} className="w-asst-message w-asst-message--you">
              <div className="w-asst-bubble">{message.text}</div>
            </div>
          )
        }
        const handed = message.proposalId === undefined || message.proposalId === null ? undefined : view.proposals.find((proposal) => proposal.id === message.proposalId)
        return (
          <Fragment key={message.id}>
            <div className="w-asst-message" data-testid="assistant-message" data-state={message.state} data-reason={message.reason}>
              <span className="w-asst-avatar w-asst-avatar--small">
                <Spark size={11} />
              </span>
              <div className="w-asst-bubble">
                {message.state === 'pending' ? (
                  <span className="w-asst-typing" aria-label="Assistant is writing">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <>
                    <AssistantWords text={message.text} />
                    <RateButtons target={{ kind: 'message', id: message.id }} rating={message.rating} />
                  </>
                )}
              </div>
            </div>
            {handed?.change === null || handed?.change === undefined ? null : <ChangeCard proposal={handed} change={handed.change} />}
          </Fragment>
        )
      })}
      <div ref={end} />
    </div>
  )
}

const percent = (value: number | null): string => (value === null ? '—' : `≈${value < 10 ? value.toFixed(1) : Math.round(value)}%`)
const thousands = (tokens: number): string => (tokens < 1000 ? String(tokens) : `${(tokens / 1000).toFixed(1)}k`)

/** The Assistant's own use of tokens and of the Limits: the share is an estimate, and says so. */
function UsageLine({ view }: { view: AssistantView }): ReactElement {
  const five = view.usage.fiveHour
  return (
    <div
      className="w-asst-usage"
      data-testid="assistant-usage"
      title="Assistant’s own use of tokens and of the Limits. worfy sees only the whole percentage of a Limits window, so Assistant’s share is estimated from its tokens."
    >
      <Spark size={12} />
      <span>
        Today <b>{thousands(view.usage.today)}</b> tokens
      </span>
      <span className="w-asst-usage__bar" aria-hidden="true">
        <i style={{ width: `${Math.min(100, (five ?? 0) * 20)}%` }} />
      </span>
      <span>
        <b>{percent(five)}</b> 5-hour
      </span>
      <span>
        <b>{percent(view.usage.sevenDay)}</b> week
      </span>
      <span className="w-asst-chip w-asst-chip--estimate">estimate</span>
    </div>
  )
}

function Composer({ on }: { on: boolean }): ReactElement {
  const [draft, setDraft] = useState('')
  const send = () => {
    const text = draft.trim()
    if (text === '' || !on) return
    void sendMessage(text).then((taken) => {
      if (!taken) return
      setDraft('')
      useAssistant.setState({ tab: 'chat' })
    })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }
  return (
    <div className="w-asst-composer">
      <textarea
        rows={1}
        aria-label="Message to Assistant"
        placeholder={on ? 'Ask Assistant, or tell it what to change…' : 'Assistant is off on this machine'}
        disabled={!on}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button type="button" className="w-asst-send" aria-label="Send" title="Send (Enter)" disabled={!on || draft.trim() === ''} onClick={send}>
        <Icon name="send" />
      </button>
    </div>
  )
}

/** The status under the header: what the Assistant watches, and whether it runs. */
function Status({ view }: { view: AssistantView }): ReactElement {
  return (
    <div className="w-asst-status">
      <span className="w-asst-avatar" data-live={view.on ? '' : undefined}>
        <Spark />
      </span>
      <div className="w-asst-status__text">
        <div className="w-asst-status__first">{view.on ? `Watching ${view.projects === 1 ? 'one Project' : `${view.projects} Projects`}` : 'Assistant is off on this machine'}</div>
        <div className="w-asst-status__second">
          <span className="w-asst-status__hours" data-in={view.workHours ? '' : undefined}>
            {view.workHours ? 'Work hours' : 'Outside work hours'}
          </span>
          <span>{view.on ? 'It tells you of what waits, here and next to its icon.' : 'The list still shows what waits.'}</span>
        </div>
      </div>
    </div>
  )
}

export function AssistantPanel({ view }: { view: AssistantView }): ReactElement {
  const tab = useAssistant((state) => state.tab)
  const focus = useAssistant((state) => state.focus)
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focus === null) return
    body.current?.querySelector(`[data-item-id="${CSS.escape(focus)}"]`)?.scrollIntoView?.({ block: 'center' })
  }, [focus, tab])
  return (
    <div className="w-asst">
      <Status view={view} />
      <div className="w-asst-tabs" role="tablist" aria-label="Assistant">
        {TABS.map((each) => (
          <button key={each.tab} type="button" role="tab" aria-selected={tab === each.tab} data-tab={each.tab} onClick={() => useAssistant.setState({ tab: each.tab, focus: null })}>
            {each.label}
            {each.tab === 'waits' && view.items.length > 0 ? <span className="w-asst-tabs__count">{view.items.length}</span> : null}
          </button>
        ))}
      </div>
      <div ref={body} className="w-asst-body" role="tabpanel">
        {view.offer.owed ? <OfferCard /> : null}
        {/* A throw in one tab stays in it (worfy-polish 163); the key gives each tab its own boundary. */}
        <ErrorBoundary key={tab} scope="tab" name={`assistant-${tab}`}>
          {tab === 'waits' ? <Waits view={view} /> : tab === 'summary' ? <Summary view={view} /> : tab === 'journal' ? <Journal view={view} /> : <Chat view={view} />}
        </ErrorBoundary>
      </div>
      <UsageLine view={view} />
      <Composer on={view.on} />
    </div>
  )
}
