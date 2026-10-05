import type { RailBlock, RailBlockProps } from './rail/index'

// The right rail of the Session view: the blocks of rail/ (rail/index.ts) one under another. Both
// Session views draw it: a Session of worfy (SessionView.tsx) and a Session started outside worfy
// (ExternalSessionPanel.tsx).

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
