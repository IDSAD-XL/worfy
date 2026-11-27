// The icons of the Settings window's section list (worfy-polish ticket 166): 16 × 16 line glyphs in the current colour,
// drawn like the app's other inline icons. A glyph the Assistant's icons already draw (assistant/icons.tsx) is that
// glyph, and so is the Assistant's own mark; Machines and Pipeline repeat their rail icons (shell/sidebar/). A section
// file names its glyph in its `icon` export (sections.ts checks the name against SETTINGS_ICONS).
import type { ReactElement, ReactNode } from 'react'
import { Icon, Spark } from '../assistant/icons'
import type { SettingsIconName } from './sections'

const SIZE = 16

/** A line glyph: the stroke style of the app's inline icons. */
function line(paths: ReactNode): ReactElement {
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {paths}
    </svg>
  )
}

/** Every glyph a section may name; the type keeps the list and the names in step. */
const GLYPHS: Record<SettingsIconName, ReactElement> = {
  // From the Assistant's set (assistant/icons.tsx).
  heart: <Icon name="heart" size={SIZE} />,
  terminal: <Icon name="term" size={SIZE} />,
  chat: <Icon name="chat" size={SIZE} />,
  list: <Icon name="list" size={SIZE} />,
  pr: <Icon name="pr" size={SIZE} />,
  // The Assistant's own mark.
  spark: <Spark size={SIZE} />,
  // Two sliders with their knobs: the app's own settings.
  sliders: line(
    <>
      <path d="M2.5 5h2.8M8.3 5h5.2M2.5 11h7.2M12.7 11h.8" />
      <circle cx="6.8" cy="5" r="1.5" />
      <circle cx="11.2" cy="11" r="1.5" />
    </>
  ),
  keyboard: line(
    <>
      <rect x="1.8" y="4" width="12.4" height="8" rx="1.3" />
      <path d="M4.5 6.8h.01M6.8 6.8h.01M9.2 6.8h.01M11.5 6.8h.01M5.5 9.5h5" />
    </>
  ),
  // The rail icon of Machines.
  monitor: line(
    <>
      <rect x="1.8" y="2.5" width="12.4" height="8.5" rx="1.3" />
      <path d="M5.5 14h5M8 11v3" />
    </>
  ),
  // Three stacked layers: the Vendors this build can run.
  layers: line(<path d="M8 2.2 13.8 5 8 7.8 2.2 5zM2.2 8 8 10.8 13.8 8M2.2 11 8 13.8 13.8 11" />),
  // Play in a circle: work that starts by itself.
  autopilot: line(
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M6.8 5.6v4.8L10.4 8z" />
    </>
  ),
  // The rail icon of Pipeline: three columns of a board.
  columns: line(
    <>
      <rect x="1.8" y="2.5" width="3.4" height="11" rx="1" />
      <rect x="6.3" y="2.5" width="3.4" height="7" rx="1" />
      <rect x="10.8" y="2.5" width="3.4" height="4.5" rx="1" />
    </>
  ),
  // Two Nodes and the edge between them.
  canvas: line(
    <>
      <rect x="1.8" y="2.5" width="5.2" height="4" rx="1" />
      <rect x="9" y="9.5" width="5.2" height="4" rx="1" />
      <path d="M7 4.5h2.1a1.6 1.6 0 0 1 1.6 1.6v3.4" />
    </>
  ),
  globe: line(
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M2.2 8h11.6M8 2.2c1.5 1.6 2.3 3.5 2.3 5.8S9.5 12.2 8 13.8C6.5 12.2 5.7 10.3 5.7 8S6.5 3.8 8 2.2z" />
    </>
  ),
  // A plug: the outside services worfy connects to.
  plug: line(<path d="M6 2v3M10 2v3M4.5 5h7v2.3a3.5 3.5 0 0 1-7 0zM8 10.8V14" />),
}

/** The glyph of a section row; decoration only, the row carries the section's name. */
export function SettingsIcon({ name }: { name: SettingsIconName }): ReactElement {
  return GLYPHS[name]
}
