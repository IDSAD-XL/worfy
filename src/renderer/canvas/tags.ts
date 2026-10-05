// Tags of Nodes (ticket 29): free-form strings on a Node, shown in its header (NodeChrome.tsx),
// added and removed from the selection toolbar for every selected Node at once. They are kept in
// the Node's `tags` field of the Layout and changed only through `tag` operations to main. The
// filter by tag is the command palette's (ticket 31).
import { TAG_LENGTH_MAX, type LayoutNode, type LayoutOpInput } from '../../shared/layout/types'

/** A tag as typed, made fit for the Layout: trimmed, inner whitespace collapsed; undefined when nothing is left or it is too long. */
export function normalizeTag(raw: string): string | undefined {
  const tag = raw.trim().replace(/\s+/g, ' ')
  if (tag === '' || tag.length > TAG_LENGTH_MAX) return undefined
  return tag
}

export interface SelectionTag {
  tag: string
  /** How many of the selected Nodes carry it. */
  count: number
}

/** Every tag of the selected Nodes, in alphabetical order, with how many of them carry it. */
export function selectionTags(nodes: readonly LayoutNode[]): SelectionTag[] {
  const counts = new Map<string, number>()
  for (const node of nodes) for (const tag of new Set(node.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag))
}

/** One `tag` operation per Node that does not carry the tag yet. */
export function addTagOps(nodes: readonly LayoutNode[], tag: string): LayoutOpInput[] {
  return nodes.filter((node) => !node.tags.includes(tag)).map((node) => ({ op: 'tag', id: node.id, add: [tag] }))
}

/** One `tag` operation per Node that carries the tag. */
export function removeTagOps(nodes: readonly LayoutNode[], tag: string): LayoutOpInput[] {
  return nodes.filter((node) => node.tags.includes(tag)).map((node) => ({ op: 'tag', id: node.id, remove: [tag] }))
}
