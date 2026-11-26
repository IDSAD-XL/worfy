// The pieces of the Assistant's section and speech card (worfy-assistant ticket 14), after the prototype Card the owner
// accepted: an item with its reason, its source and its duty, its buttons — Open, Prepare, Snooze, Dismiss — and like and
// dislike; the card of an item a dislike just hid, with the rule and Undo; like and dislike on any message; and what waits
// on a Linked machine, read-only (worfy-assistant ticket 18).
import { useState, type ReactElement } from 'react'
import type { LinkedMachineWaits } from '../../shared/assistant/linked'
import type { Rating, SnoozeChoice, WindowItem } from '../../shared/assistant/window'
import type { RatingTarget } from '../../shared/ipc/assistant'
import { Markdown } from '../markdown/Markdown'
import { Menu, MenuItem, MenuSeparator } from '../theme/kit/Menu'
import { itemIcon, shortTime } from './format'
import { Icon, Spark } from './icons'
import { openItem } from './open'
import { closeCard, itemAction, prepareItem, rate, snoozeItem, undoDislike, type GoneItem } from './useAssistant'

/**
 * The text of a message the Assistant wrote — in the Chat and the morning summary of Summary — as Markdown, with the
 * renderer of the Session view (markdown/Markdown.tsx, `breaks` as the transcript has it; worfy-polish ticket 162).
 * That renderer keeps raw HTML as text and loads no image. An answer may quote outside text from a source
 * (worfy-assistant ticket 09): its http(s):// links still open, in the browser, so `showLinkHost` puts the host a link
 * opens beside one whose text names something else — «Approve (evil.example)». Other schemes open nothing. One-line
 * labels — an item's title and reason, the Journal's rows, the speech card's head — stay plain text, and so do the
 * user's messages, as in the Session view. No Project: a file link names no Project's file, so it is inert text.
 */
export function AssistantWords({ text }: { text: string }): ReactElement {
  return (
    <div className="w-asst-text w-asst-md">
      <Markdown text={text} breaks showLinkHost />
    </div>
  )
}

/** Like and dislike of a message of the Assistant; a second press takes the rating back. */
export function RateButtons({ target, rating, item, from }: { target: RatingTarget; rating: Rating | null; item?: WindowItem; from?: 'say' }): ReactElement {
  const press = (next: Rating) => {
    void rate(target, rating === next ? null : next, item)
    if (from === 'say' && item !== undefined && next === 'dislike') closeCard(item.id)
  }
  return (
    <span className="w-asst-rate">
      <button type="button" className="w-asst-rate__button" data-rate="like" aria-label="Like" title="Like: more like this" aria-pressed={rating === 'like'} onClick={() => press('like')}>
        <Icon name="up" />
      </button>
      <button type="button" className="w-asst-rate__button" data-rate="dislike" aria-label="Dislike" title="Dislike: stop items like this" aria-pressed={rating === 'dislike'} onClick={() => press('dislike')}>
        <Icon name="down" />
      </button>
    </span>
  )
}

const SNOOZE: readonly { choice: SnoozeChoice; label: string }[] = [
  { choice: 'hour', label: 'In 1 hour' },
  { choice: 'three-hours', label: 'In 3 hours' },
  { choice: 'next-work-hours', label: 'Next work hours' },
]

function SnoozeButton({ item, from }: { item: WindowItem; from?: 'say' }): ReactElement {
  const [open, setOpen] = useState(false)
  const pick = (choice: SnoozeChoice) => {
    void snoozeItem(item.id, choice)
    if (from === 'say') closeCard(item.id)
  }
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      label="Snooze until"
      className="w-asst-menu"
      trigger={
        <button type="button" className="w-asst-button" data-action="snooze">
          <Icon name="clock" />
          Snooze
          <Icon name="chev" size={12} />
        </button>
      }
    >
      <div className="w-asst-menu__heading">Snooze until</div>
      {SNOOZE.map(({ choice, label }) => (
        <MenuItem key={choice} onClick={() => pick(choice)} testId={`assistant-snooze-${choice}`}>
          <Icon name="clock" />
          {label}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem onClick={() => pick('change')} testId="assistant-snooze-change">
        <Icon name="bell" />
        Until something changes
      </MenuItem>
    </Menu>
  )
}

/** The buttons of an item: in the list, or on the speech card (`say`), which has no Dismiss and closes once used. */
export function ItemActions({ item, from }: { item: WindowItem; from?: 'say' }): ReactElement {
  const used = () => {
    if (from === 'say') closeCard(item.id)
  }
  return (
    <div className="w-asst-actions">
      {item.state === 'snoozed' ? (
        <button type="button" className="w-asst-button" data-action="wake" onClick={() => void itemAction(item.id, 'wake')}>
          <Icon name="bell" />
          Wake now
        </button>
      ) : null}
      {item.open !== null ? (
        <button
          type="button"
          className="w-asst-button"
          data-action="open"
          onClick={() => {
            used()
            void openItem(item)
          }}
        >
          <Icon name="open" />
          Open
        </button>
      ) : null}
      {item.prepare !== null ? (
        <button
          type="button"
          className="w-asst-button w-asst-button--assistant"
          data-action="prepare"
          title="See the exact text of the Session before it starts"
          onClick={() => {
            used()
            prepareItem(item)
          }}
        >
          <Icon name="doc" />
          Prepare
        </button>
      ) : null}
      {item.state !== 'snoozed' ? <SnoozeButton item={item} {...(from === undefined ? {} : { from })} /> : null}
      {from === undefined ? (
        <button type="button" className="w-asst-button w-asst-button--ghost" data-action="dismiss" onClick={() => void itemAction(item.id, 'dismiss')}>
          Dismiss
        </button>
      ) : null}
      <RateButtons target={{ kind: 'item', id: item.id }} rating={item.rating} item={item} {...(from === undefined ? {} : { from })} />
    </div>
  )
}

/** What an item is: its glyph, its line, its reason and the time it came. */
export function ItemHead({ item }: { item: WindowItem }): ReactElement {
  return (
    <div className="w-asst-item__top">
      <span className="w-asst-kind" data-urgent={item.urgent ? '' : undefined}>
        <Icon name={itemIcon(item.source, item.kind, item.subject.kind)} />
      </span>
      <div className="w-asst-item__main">
        <div className="w-asst-item__title">{item.title}</div>
        {item.why !== null ? <div className="w-asst-item__why">{item.why}</div> : null}
      </div>
      <span className="w-asst-item__since w-mono">{shortTime(item.lastAt)}</span>
    </div>
  )
}

/** The chips of an item: urgent, its Project, the duty that raised it, until when it is snoozed. */
export function ItemMeta({ item }: { item: WindowItem }): ReactElement {
  return (
    <div className="w-asst-meta">
      {item.urgent ? (
        <span className="w-asst-chip w-asst-chip--urgent">
          <Icon name="bolt" size={12} />
          Urgent
        </span>
      ) : null}
      {item.projectName !== null ? <span className="w-asst-chip w-asst-chip--project w-mono">{item.projectName}</span> : null}
      {item.duty !== null ? (
        <span className="w-asst-chip w-asst-chip--duty" title="The duty that raised it">
          <Spark size={11} />
          {item.duty.title}
        </span>
      ) : null}
      {item.state === 'snoozed' ? (
        <span className="w-asst-chip">
          <Icon name="clock" size={12} />
          {item.snoozedUntil == null ? 'until it changes' : `until ${shortTime(item.snoozedUntil)}`}
        </span>
      ) : null}
    </div>
  )
}

/** The source of an item: where it came from, and, for an outside source, who wrote it — data, never instructions. */
export function ItemSource({ item }: { item: WindowItem }): ReactElement {
  return (
    <div className="w-asst-source">
      <Icon name={item.outside !== null ? 'lock' : 'info'} size={12} />
      <span>
        {item.sourceLabel} · {item.subject.label}
      </span>
      {item.outside !== null ? (
        <span className="w-asst-data" title="Text from outside: Assistant reads it as data, never as instructions">
          data
        </span>
      ) : null}
    </div>
  )
}

/** One item of the list. */
export function ItemCard({ item, focus }: { item: WindowItem; focus: boolean }): ReactElement {
  return (
    <article className="w-asst-item" data-testid="assistant-item" data-item-id={item.id} data-urgent={item.urgent ? '' : undefined} data-focus={focus ? '' : undefined}>
      <ItemHead item={item} />
      <ItemMeta item={item} />
      <ItemSource item={item} />
      <ItemActions item={item} />
      {item.rating === 'like' && item.duty !== null ? (
        <div className="w-asst-note">
          <span className="w-asst-avatar w-asst-avatar--small">
            <Spark size={11} />
          </span>
          <span>
            Noted. I’ll keep showing items like this from <b>{item.duty.title}</b>.
          </span>
        </div>
      ) : null}
    </article>
  )
}

/** An item a dislike just hid: the rule that hides such items now, and Undo. */
export function GoneCard({ gone }: { gone: GoneItem }): ReactElement {
  return (
    <div className="w-asst-gone" data-testid="assistant-gone" data-item-id={gone.item.id}>
      <span className="w-asst-avatar w-asst-avatar--small">
        <Spark size={11} />
      </span>
      <div className="w-asst-gone__body">
        <b>Removed “{gone.item.title}”.</b> I won’t show items like this{gone.item.duty === null ? '' : ` from ${gone.item.duty.title}`}. New rule in my memory:
        <span className="w-asst-rule w-mono">{gone.rule.text}</span>
        <div className="w-asst-actions">
          <button type="button" className="w-asst-button" data-action="undo" onClick={() => void undoDislike(gone)}>
            <Icon name="undo" />
            Undo
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * What waits on a Linked machine (worfy-assistant ticket 18; boundary 5): its items under its name, read-only — that
 * Machine's own Assistant keeps them, so a card here has no button — or why it shows nothing.
 */
export function LinkedMachine({ machine }: { machine: LinkedMachineWaits }): ReactElement {
  return (
    <section className="w-asst-linked" data-testid="assistant-linked" data-machine-id={machine.id}>
      <div className="w-asst-group">
        On {machine.name} · read-only {machine.items.length > 0 ? <span className="w-asst-group__count">{machine.items.length}</span> : null}
      </div>
      {machine.problem !== null ? (
        <div className="w-asst-hidden-line" data-testid="assistant-linked-problem">
          <Icon name="info" size={12} />
          {machine.problem}
        </div>
      ) : null}
      {machine.items.map((item) => (
        <article key={item.id} className="w-asst-item w-asst-item--linked" data-testid="assistant-linked-item" data-urgent={item.urgent ? '' : undefined}>
          <div className="w-asst-item__top">
            <span className="w-asst-kind" data-urgent={item.urgent ? '' : undefined}>
              <Icon name={itemIcon(item.source, item.kind, item.subject.kind)} />
            </span>
            <div className="w-asst-item__main">
              <div className="w-asst-item__title">{item.title}</div>
            </div>
            <span className="w-asst-item__since w-mono">{shortTime(item.lastAt)}</span>
          </div>
          <div className="w-asst-meta">
            {item.urgent ? (
              <span className="w-asst-chip w-asst-chip--urgent">
                <Icon name="bolt" size={12} />
                Urgent
              </span>
            ) : null}
            {item.projectName !== null ? <span className="w-asst-chip w-asst-chip--project w-mono">{item.projectName}</span> : null}
            {item.duty !== null ? (
              <span className="w-asst-chip w-asst-chip--duty" title="The duty that raised it there">
                <Spark size={11} />
                {item.duty}
              </span>
            ) : null}
            <span className="w-asst-chip" title={`The Assistant of ${machine.name} keeps it: open it there`}>
              <Icon name="lock" size={12} />
              Read-only
            </span>
          </div>
          <div className="w-asst-source">
            <Icon name={item.outside !== null ? 'lock' : 'info'} size={12} />
            <span>
              {item.sourceLabel} · {item.subject.label}
            </span>
          </div>
        </article>
      ))}
    </section>
  )
}
