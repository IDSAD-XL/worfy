// Groups of the command palette (⌘K). The palette ranks first (find/search-index.ts, rankItems) and
// groups after: a group stands where its first — best — row stands, and inside a group the rows keep
// the ranking's order (by score, ties in the order the commands were built). With the empty query
// every row scores the same, so the groups come in the order of their first built command.

export interface RowGroup<T, G> {
  name: G
  rows: T[]
}

/** `ranked` cut into groups by `groupOf`, ordered by each group's first row; rows keep their order. */
export function groupRows<T, G>(ranked: readonly T[], groupOf: (row: T) => G): RowGroup<T, G>[] {
  const groups = new Map<G, RowGroup<T, G>>()
  for (const row of ranked) {
    const name = groupOf(row)
    const group = groups.get(name)
    if (group === undefined) groups.set(name, { name, rows: [row] })
    else group.rows.push(row)
  }
  return [...groups.values()]
}
