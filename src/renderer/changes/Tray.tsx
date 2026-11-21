import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { SHORTCUTS } from '../../shared/shortcuts'
import type { ChangesTarget } from './line-comments'
import { chipWords, linesLabel, type CodeComment, type QuoteComment } from '../session/quote-comments'
import { matches as matchesShortcut } from '../shortcuts/match'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../theme/kit/Menu'

// The tray at the bottom of the Changes view (worfy-changes-view tickets 05 and 08; the screen of the spec): the comments of
// the Session picked in «To» — the same ones its input field lists (session/QuoteComments.tsx), from its store
// (quote-store.ts, quoteKey) — as chips: a comment on lines goes to its line, × removes it. Clear removes them all.
// Under them the general text, «To» and Send ⌘↵, which sends them as that Session's Send does: one message. While Send
// runs, «To», the field, × and Clear are locked: the round goes to the Session it was sent to, as it was sent.

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** «3 comments on 2 files»; the comments on messages of the Session, when it has some, after them. */
function trayCount(comments: readonly QuoteComment[]): string {
  const code = comments.filter((each): each is CodeComment => each.kind === 'code')
  const files = new Set(code.map((each) => `${each.repository}\u0000${each.path}`)).size
  const onMessages = comments.length - code.length
  const head = `${plural(code.length, 'comment')} on ${plural(files, 'file')}`
  return onMessages === 0 ? head : `${head} · ${onMessages} on messages`
}

export interface TrayProps {
  /** The comments of the Session in «To», in the order the agent reads them. */
  comments: readonly QuoteComment[]
  /** The comments whose lines a Refresh did not find. */
  changed: ReadonlySet<string>
  targets: readonly ChangesTarget[]
  target: ChangesTarget | null
  onTarget: (nodeId: string) => void
  /** Autopilot runs in the Project now. */
  autopilot: boolean
  general: string
  onGeneral: (text: string) => void
  onGo: (comment: CodeComment) => void
  onRemove: (ids: readonly string[]) => void
  onSend: () => void
  sending: boolean
  error: string | null
  sendKeys: string
}

export function Tray({ comments, changed, targets, target, onTarget, autopilot, general, onGeneral, onGo, onRemove, onSend, sending, error, sendKeys }: TrayProps) {
  const [open, setOpen] = useState(false)
  const empty = comments.length === 0 && general.trim() === ''
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    // The view's own keys (j, k, n, p, c) are not for the tray's field.
    event.stopPropagation()
    if (matchesShortcut(event.nativeEvent, SHORTCUTS.quoteSave)) {
      event.preventDefault()
      if (!empty && !sending && target !== null) onSend()
    }
  }
  return (
    <section className="w-ctray nodrag" aria-label="Comments to send" data-testid="changes-tray">
      <div className="w-ctray__head">
        <span className="w-ctray__count" data-testid="changes-tray-count">
          {trayCount(comments)}
        </span>
        <ul className="w-ctray__chips" aria-label="Comments">
          {comments.map((each, index) => (
            <li key={each.id} className="w-qtray__chip" data-testid="changes-tray-chip" data-comment-id={each.id}>
              {each.kind === 'code' ? (
                <button type="button" className="w-qtray__go" title={each.text || 'Image only'} aria-label={`Comment ${index + 1} on ${linesLabel(each.path, each.startLine, each.endLine)}. Show it.`} data-testid="changes-tray-go" onClick={() => onGo(each)}>
                  <span className="w-qtray__q w-mono">{linesLabel(each.path.slice(each.path.lastIndexOf('/') + 1), each.startLine, each.endLine)}</span>
                  {changed.has(each.id) ? <span className="w-cl__changed">Line changed</span> : null}
                </button>
              ) : (
                <span className="w-qtray__go" title={each.text || 'Image only'}>
                  <span className="w-qtray__q">«{chipWords(each.quote)}»</span>
                </span>
              )}
              <button type="button" className="w-qtray__x" aria-label={`Remove comment ${index + 1}`} data-testid="changes-tray-remove" disabled={sending} onClick={() => onRemove([each.id])}>
                ×
              </button>
            </li>
          ))}
        </ul>
        <span className="w-qtray__spacer" />
        {comments.length > 0 ? (
          <button type="button" className="w-changes__link" data-testid="changes-tray-clear" disabled={sending} onClick={() => onRemove(comments.map((each) => each.id))}>
            Clear
          </button>
        ) : null}
      </div>
      <div className="w-ctray__send">
        <span className="w-ctray__to">To</span>
        <Menu
          open={open}
          onOpenChange={setOpen}
          label="Send to"
          testId="changes-to-menu"
          inNode
          className="w-changes__menu"
          focusOnOpen='[aria-checked="true"]'
          trigger={
            <button type="button" className="w-changes__dropdown nodrag" data-testid="changes-to" aria-label={`To: ${target?.title ?? 'no Session'}`} disabled={targets.length === 0 || sending}>
              {target?.title ?? 'No Session'}
            </button>
          }
        >
          <MenuRadioGroup value={target?.nodeId ?? ''} onValueChange={(value) => onTarget(String(value))}>
            {targets.map((each) => (
              <MenuRadioItem key={each.nodeId} value={each.nodeId} className="w-row" testId="changes-to-item" data-node={each.nodeId} closeOnClick>
                <span className="w-row__label">{each.title}</span>
                <span className="w-row__trailing">{each.kind === 'orchestrator' ? 'the Project’s Orchestrator' : 'bound to this Ticket'}</span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </Menu>
        {autopilot && target?.kind === 'orchestrator' ? (
          <span className="w-ctray__warn" role="status" data-testid="changes-to-autopilot">
            Autopilot is running
          </span>
        ) : null}
        <textarea
          className="w-ctray__field"
          rows={1}
          aria-label="Message to the agent"
          placeholder="Message to the agent…"
          data-testid="changes-tray-text"
          value={general}
          readOnly={sending}
          onChange={(event) => onGeneral(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="w-qbtn w-qbtn--primary" data-testid="changes-tray-send" disabled={empty || sending || target === null} onClick={onSend}>
          Send <kbd className="w-qkbd">{sendKeys}</kbd>
        </button>
      </div>
      {error !== null ? (
        <p className="w-ctray__error" role="alert" data-testid="changes-tray-error">
          {error}
        </p>
      ) : null}
    </section>
  )
}
