import { useEffect, useRef, type KeyboardEvent } from 'react'
import { SHORTCUTS } from '../../shared/shortcuts'
import { label, matches } from '../shortcuts/match'
import type { TranscriptFindState } from './transcript-find'

// The find bar of the Session view (⌘F, Ctrl+F on Windows and Linux; worfy-ui ticket 26), at the
// top right of the transcript, under the header: the query, «3 of 12», the previous and next match
// and Close. Enter and Shift+Enter step through the matches, Esc closes. What it finds and how it
// reaches a match behind «Load earlier» is transcript-find.ts.

export function SessionFind({ find }: { find: TranscriptFindState }) {
  const input = useRef<HTMLInputElement>(null)
  const { focusSeq } = find

  // ⌘F again with the bar open takes the field anew, its text selected.
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusSeq])

  if (!find.open) return null

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const key = event.nativeEvent
    if (key.isComposing) return
    if (matches(key, SHORTCUTS.findClose)) {
      event.preventDefault()
      find.close()
    } else if (matches(key, SHORTCUTS.findNext) || matches(key, SHORTCUTS.findPrevious)) {
      event.preventDefault()
      find.step(event.shiftKey)
    }
  }

  return (
    <div className="w-session-find" role="search" aria-label="Find in the Session" data-testid="session-find" data-toast-keep-out="" aria-busy={find.loading}>
      <input
        ref={input}
        className="w-session-find__input"
        aria-label="Find in the Session"
        placeholder="Find in the Session"
        spellCheck={false}
        data-testid="session-find-input"
        value={find.query}
        onChange={(event) => find.setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="w-session-find__count w-mono" data-testid="session-find-count" aria-live="polite" title={find.note ?? undefined}>
        {find.loading ? 'Loading earlier…' : find.count}
      </span>
      <button type="button" className="w-session-find__button" aria-label="Previous match" title={`Previous match (${label(SHORTCUTS.findPrevious)})`} onClick={() => find.step(true)}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 10l4-4 4 4" />
        </svg>
      </button>
      <button type="button" className="w-session-find__button" aria-label="Next match" title={`Next match (${label(SHORTCUTS.findNext)})`} onClick={() => find.step(false)}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      <button type="button" className="w-session-find__button" aria-label="Close" title={`Close (${label(SHORTCUTS.findClose)})`} onClick={find.close}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </svg>
      </button>
    </div>
  )
}
