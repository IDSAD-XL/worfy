import type { CanvasNodeProps } from './nodes'

/**
 * Draws a Node whose kind this build has no file for (written by a newer worfy or by a tool).
 * It can be moved like any Node; its data is kept as it is.
 */
export function UnknownNode({ data }: CanvasNodeProps) {
  return (
    <div className="w-node-surface w-unknown-node" data-testid="unknown-node">
      Unknown node: <span className="w-mono">{data.node.kind}</span>
    </div>
  )
}
