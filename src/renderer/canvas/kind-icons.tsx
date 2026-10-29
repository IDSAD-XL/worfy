// The kind of a Node in its header (worfy-canvas ticket 05, ADR-0077; docs/design/F-SPEC.md,
// "Node header"): a 4 px band along the top of the header and an icon before the title, both in
// the `band` colour of the kind's `kind-*` role. Only Orchestrator, Session, Subagent and the Epic
// frame have a kind colour; every other Node kind is neutral and draws neither. A Subagent's band is
// dashed, in the Session's colour (`--kind-subagent`). Kind colours never reach a status chip or
// status text: the status keeps its own roles and its word.
//
// Both are decoration (`aria-hidden`); the Node names its kind in its own `aria-label`.
import type { CSSProperties } from 'react'
import { KIND, type NodeKindColour } from './kind-colours'

const colourOf = (kind: NodeKindColour): string => KIND[kind].band

const ICON_PATHS: Record<NodeKindColour, readonly string[]> = {
  // A hub with three spokes: the Session that runs the others.
  orchestrator: ['M8 6.2V3.6', 'M6.4 9l-2.3 1.4', 'M9.6 9l2.3 1.4', 'M9.8 8a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0Z', 'M9.4 2.4a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0Z', 'M4.2 11.6a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0Z', 'M14.6 11.6a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0Z'],
  // The prompt `>_`.
  session: ['M3 4.5l3.5 3.5L3 11.5', 'M8.5 12h5'],
  // A branch off its Session.
  subagent: ['M4 2.5v6a2.5 2.5 0 0 0 2.5 2.5H13', 'M10.5 8.5L13 11l-2.5 2.5'],
  // A frame with its header row.
  epic: ['M2.5 3.5h11v9h-11z', 'M2.5 6.5h11'],
}

const iconStyle = (kind: NodeKindColour): CSSProperties => ({ flex: 'none', display: 'block', color: colourOf(kind) })

/** The kind's icon, in its `band` colour. */
export function KindIcon({ kind, size = 14 }: { kind: NodeKindColour; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-testid="kind-icon"
      data-kind={kind}
      style={iconStyle(kind)}
    >
      {ICON_PATHS[kind].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

const BAND_HEIGHT = 4

const bandStyle = (kind: NodeKindColour): CSSProperties => ({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  pointerEvents: 'none',
  ...(kind === 'subagent' ? { height: 0, borderTop: `${BAND_HEIGHT}px dashed ${colourOf(kind)}` } : { height: BAND_HEIGHT, backgroundColor: colourOf(kind) }),
})

/**
 * The 4 px band along the top of a header. It is placed absolutely: the header (or whatever holds
 * it) is `position: relative`, and the Node's rounded, clipping surface cuts its corners.
 */
export function KindBand({ kind }: { kind: NodeKindColour }) {
  return <span aria-hidden="true" data-testid="kind-band" data-kind={kind} style={bandStyle(kind)} />
}
