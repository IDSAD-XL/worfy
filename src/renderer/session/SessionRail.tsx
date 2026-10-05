import type { RailBlock, RailBlockProps } from './rail/index'

// The right rail of a Session started outside worfy (ExternalSessionPanel.tsx): the blocks of rail/
// (rail/index.ts) one under another. SessionView.tsx still has its own copy of this component for a
// Session of worfy; tickets 18 and 19 edit that file in the same wave, so the copy is replaced by
// this one only after they merge.

export function SessionRail({ blocks, ...props }: RailBlockProps & { blocks: readonly RailBlock[] }) {
  if (blocks.length === 0) return null
  return (
    <aside className="w-session__rail" aria-label="Session details" data-testid="session-rail">
      {blocks.map(({ id, Component }) => (
        <section key={id} className="w-session__rail-block" data-block={id}>
          <Component {...props} />
        </section>
      ))}
    </aside>
  )
}
