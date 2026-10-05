// The one button every action of ticket 23 draws ("Ship ticket", "Run wave", "Open PR"). Written
// without JSX on purpose: the action slot (badges/index.ts) collects every .tsx file of this
// folder as an action, and this is not one.
//
// An inactive button stays focusable and keeps its tooltip, which says why it is inactive
// (`aria-disabled` rather than `disabled`: a disabled button shows no tooltip). An active one
// shows what it will send. While a run is in flight the button is inactive; a failed run shows
// main's reason until the next try.
import { createElement, useState, type ReactElement } from 'react'
import './actions.css'

export interface ActionButtonProps {
  label: string
  /** Active: `title` says what the click does. Inactive: `title` says why not. */
  enabled: boolean
  title: string
  /** The run; resolves to main's reason when it was refused, undefined when it worked. */
  run: () => Promise<string | undefined>
  primary?: boolean
  testId: string
}

export function ActionButton({ label, enabled, title, run, primary = false, testId }: ActionButtonProps): ReactElement {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = enabled && !running
  const onClick = () => {
    if (!active) return
    setRunning(true)
    setError(null)
    void run()
      .then((failure) => setError(failure ?? null))
      .finally(() => setRunning(false))
  }
  return createElement(
    'button',
    {
      type: 'button',
      className: `w-action nodrag${primary ? ' w-action--primary' : ''}`,
      'aria-disabled': active ? 'false' : 'true',
      title: error ?? title,
      'data-testid': testId,
      'data-error': error ?? undefined,
      onClick,
      onDoubleClick: (event: { stopPropagation(): void }) => event.stopPropagation(),
    },
    label,
  )
}
