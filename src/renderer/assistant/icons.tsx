// The glyphs of the Assistant's section and speech card (worfy-assistant ticket 14), drawn as in the prototype Card the owner
// accepted: 16×16 strokes in the current colour, and the Assistant's own mark — two sparks, filled.
import type { ReactElement, ReactNode } from 'react'

const PATHS = {
  up: <path d="M5 7.2v6.3H2.8V7.2zM5 7.2 7.7 2.5c.9 0 1.6.8 1.4 1.7l-.5 2.2h3.9a1.3 1.3 0 0 1 1.3 1.5l-.8 4.5a1.3 1.3 0 0 1-1.3 1.1H5" />,
  down: (
    <g transform="rotate(180 8 8)">
      <path d="M5 7.2v6.3H2.8V7.2zM5 7.2 7.7 2.5c.9 0 1.6.8 1.4 1.7l-.5 2.2h3.9a1.3 1.3 0 0 1 1.3 1.5l-.8 4.5a1.3 1.3 0 0 1-1.3 1.1H5" />
    </g>
  ),
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
  bolt: <path d="M9 1.8 3.5 9h4l-1 5.2L12.5 7h-4z" />,
  clock: <path d="M8 3.2a5.3 5.3 0 1 0 0 10.6A5.3 5.3 0 0 0 8 3.2zM8 5.8v2.9l1.9 1.2M2.8 2.6 1.7 3.7M13.2 2.6l1.1 1.1" />,
  info: <path d="M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2zM8 7.3v3.6M8 5h.01" />,
  open: <path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />,
  doc: <path d="M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3M5.5 8.5h5M5.5 11h3" />,
  chev: <path d="M4.5 6.5 8 10l3.5-3.5" />,
  chevr: <path d="M6.5 4.5 10 8l-3.5 3.5" />,
  bell: <path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1H3zM6.8 14h2.4" />,
  undo: <path d="M5.5 4 2.5 7l3 3M2.5 7h7a3.5 3.5 0 0 1 0 7H8" />,
  eyeoff: <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4zM2.5 13.5l11-11" />,
  sun: <path d="M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />,
  send: <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />,
  x: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  term: (
    <>
      <rect x="1.8" y="2.5" width="12.4" height="11" rx="1.6" />
      <path d="M4.5 6l2 2-2 2M8 10h3.5" />
    </>
  ),
  pr: <path d="M4.5 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM4.5 11a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM11.5 11a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7.5M9 3l-1.5 1.5L9 6" />,
  ci: <path d="M8 2.2a5.8 5.8 0 1 0 0 11.6A5.8 5.8 0 0 0 8 2.2zM6 6l4 4M10 6l-4 4" />,
  run: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <rect x="6" y="6" width="4" height="4" rx=".6" />
    </>
  ),
  ask: <path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H7l-3 2.5V11a1.5 1.5 0 0 1-1.5-1.5zM6.6 5.4a1.5 1.5 0 1 1 1.9 1.4c-.4.2-.5.4-.5.8M8 9.2h.01" />,
  chat: <path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H7l-3 2.5V11a1.5 1.5 0 0 1-1.5-1.5z" />,
  slack: <path d="M6.3 2.5 5 13.5M11.3 2.5 10 13.5M2.8 6h11M2.2 10h11" />,
  jira: <path d="M8 1.8 14.2 8 8 14.2 1.8 8zM8 5.4 10.6 8 8 10.6 5.4 8z" />,
  heart: <path d="M8 13.5S2.2 10 2.2 6a2.9 2.9 0 0 1 5.8-1 2.9 2.9 0 0 1 5.8 1c0 4-5.8 7.5-5.8 7.5z" />,
  gauge: <path d="M2.5 11a5.5 5.5 0 1 1 11 0M8 11l2.6-3.2" />,
  list: <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />,
  folder: <path d="M1.8 4.2a1 1 0 0 1 1-1h3.4l1.4 1.5h5.6a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z" />,
  moon: <path d="M13 9.6A5.5 5.5 0 1 1 6.4 3a4.4 4.4 0 0 0 6.6 6.6z" />,
  check: <path d="M3 8.5l3 3 7-7" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

/** A glyph of the section, hidden from assistive technology: the control around it carries the name. */
export function Icon({ name, size = 14 }: { name: IconName; size?: number }): ReactElement {
  return (
    <svg className="w-asst-icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}

/** The Assistant's mark: a large spark and a small one. */
export function Spark({ size = 14 }: { size?: number }): ReactElement {
  return (
    <svg className="w-asst-spark" width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6.8 1.6c.45 2.9 1.75 4.2 4.65 4.65-2.9.45-4.2 1.75-4.65 4.65-.45-2.9-1.75-4.2-4.65-4.65 2.9-.45 4.2-1.75 4.65-4.65z" />
      <path d="M12.1 9.4c.22 1.4.85 2.03 2.25 2.25-1.4.22-2.03.85-2.25 2.25-.22-1.4-.85-2.03-2.25-2.25 1.4-.22 2.03-.85 2.25-2.25z" />
    </svg>
  )
}
