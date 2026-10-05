import type { NodeType } from '../nodes'

/** One item of the Canvas context menu (CanvasMenu.tsx): it creates a Node of `type`. */
export interface CreateItem {
  label: string
  type: NodeType
}

/**
 * Menu items of the Node type modules (an eager import.meta.glob of ../nodes/*Node.tsx) that
 * export a `createLabel`, sorted by label. A `createLabel` that is not a non-empty string, or one
 * on a module whose `kind` is not a registered Node type, is a programming error and throws.
 */
export function createItems(modules: Record<string, unknown>, types: ReadonlyMap<string, NodeType>): CreateItem[] {
  const items: CreateItem[] = []
  for (const [path, module] of Object.entries(modules)) {
    const { kind, createLabel } = (module ?? {}) as Record<string, unknown>
    if (createLabel === undefined) continue
    if (typeof createLabel !== 'string' || createLabel.trim() === '') throw new Error(`${path}: \`createLabel\` must be a non-empty string`)
    const type = typeof kind === 'string' ? types.get(kind) : undefined
    if (type === undefined) throw new Error(`${path}: \`createLabel\` needs the Node type's \`kind\``)
    items.push({ label: createLabel, type })
  }
  return items.sort((a, b) => a.label.localeCompare(b.label))
}
