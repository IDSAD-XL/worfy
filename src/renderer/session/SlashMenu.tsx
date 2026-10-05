import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { SlashCommand } from '../../shared/agent/commands'
import { invoke } from '../ipc'

// The slash menu of the input field (ticket 20): a `/` at the start of the field opens a popover
// with the Session's slash commands and skills, as Claude Code reports them (`agent.commands`:
// supportedCommands() and the last system/init — the user's skills under ~/.claude among them).
// What follows the slash filters the list: names that start with it first, then names that hold
// it. ↑/↓ move the selection, Tab or Return puts `/<name> ` into the field, Escape closes the menu
// until the field no longer starts with a command name. While the field shows a prompt brought back
// from the history (↑), the menu stays closed: ↑/↓ keep stepping through the history and Return
// sends it.

/** The command name being typed: the text after a leading `/`, while it holds no space. */
export function slashQuery(text: string): string | null {
  const match = /^\/(\S*)$/.exec(text)
  return match ? (match[1] ?? '') : null
}

/** The commands matching a query: names that start with it first, then names that hold it; case is ignored. */
export function matchCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const wanted = query.toLowerCase()
  const starts = commands.filter((command) => command.name.toLowerCase().startsWith(wanted))
  const holds = commands.filter((command) => !command.name.toLowerCase().startsWith(wanted) && command.name.toLowerCase().includes(wanted))
  return [...starts, ...holds]
}

/** The commands of a Session, fetched again each time the menu opens: the list may grow after the first turn. */
function useCommands(sessionId: string | null, open: boolean): readonly SlashCommand[] {
  const [found, setFound] = useState<{ sessionId: string; commands: readonly SlashCommand[] } | null>(null)
  useEffect(() => {
    if (!open || sessionId === null) return
    let current = true
    void invoke('agent.commands', { sessionId }).then((result) => {
      if (!current) return
      if (result.ok) setFound({ sessionId, commands: result.value.commands })
      else console.error(`agent.commands ${sessionId} failed:`, result.error)
    })
    return () => {
      current = false
    }
  }, [sessionId, open])
  return found !== null && found.sessionId === sessionId ? found.commands : []
}

export interface SlashMenuState {
  /** The popover, or null while the menu is closed. */
  element: ReactNode
  /** Handles a key of the field while the menu is open; true when the key was the menu's. */
  keyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
}

/**
 * The slash menu over the field whose text is `text`; picking a command calls `setText`. `browsing`
 * is true while the field shows a prompt from the history: the menu stays closed then.
 */
export function useSlashMenu(sessionId: string | null, text: string, setText: (text: string) => void, browsing = false): SlashMenuState {
  const query = browsing ? null : slashQuery(text)
  // The selection belongs to one filter: a new filter starts at the top. Escape holds until the
  // field leaves the command name. Adjusted while rendering, as React advises for state derived
  // from a prop.
  const [menu, setMenu] = useState({ query, selected: 0, dismissed: false })
  let current = menu
  if (menu.query !== query) {
    current = { query, selected: 0, dismissed: query !== null && menu.dismissed }
    setMenu(current)
  }
  const { selected, dismissed } = current
  const setSelected = (index: number) => setMenu({ ...current, selected: index })
  const commands = useCommands(sessionId, query !== null)
  const matches = query === null ? [] : matchCommands(commands, query)
  const open = query !== null && !dismissed && matches.length > 0

  const at = Math.min(selected, matches.length - 1)
  const pick = useCallback((command: SlashCommand) => setText(`/${command.name} `), [setText])

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || event.altKey || event.metaKey || event.ctrlKey) return false
    const step = (by: number) => setSelected((at + by + matches.length) % matches.length)
    if (event.key === 'ArrowDown' && !event.shiftKey) step(1)
    else if (event.key === 'ArrowUp' && !event.shiftKey) step(-1)
    else if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
      const command = matches[at]
      if (command === undefined) return false
      pick(command)
    } else if (event.key === 'Escape') setMenu({ ...current, dismissed: true })
    else return false
    event.preventDefault()
    return true
  }

  const element = open ? (
    <div className="w-slash" role="listbox" aria-label={`Commands matching /${query}`} data-testid="slash-menu">
      <div className="w-slash__head">
        <span className="w-slash__title">Commands</span>
        <span className="w-mono">↑↓ navigate · ⏎ select · esc</span>
      </div>
      <div className="w-slash__list">
        {matches.map((command, index) => (
          <div
            key={command.name}
            role="option"
            aria-selected={index === at}
            className="w-slash__item"
            data-testid="slash-item"
            data-name={command.name}
            // jsdom has no scrollIntoView.
            ref={index === at ? (node) => node?.scrollIntoView?.({ block: 'nearest' }) : undefined}
            // The field keeps the focus: a click must not blur it.
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setSelected(index)}
            onClick={() => pick(command)}
          >
            <span className="w-slash__name w-mono">
              /{command.name.toLowerCase().startsWith(query.toLowerCase()) && query !== '' ? (
                <>
                  <strong>{command.name.slice(0, query.length)}</strong>
                  {command.name.slice(query.length)}
                </>
              ) : (
                command.name
              )}
              {command.argumentHint !== '' ? <span className="w-slash__hint"> {command.argumentHint}</span> : null}
            </span>
            <span className="w-slash__description" title={command.description || undefined}>
              {command.description}
            </span>
            <span className="w-slash__kind w-mono">{command.kind}</span>
          </div>
        ))}
      </div>
    </div>
  ) : null

  return { element, keyDown }
}
