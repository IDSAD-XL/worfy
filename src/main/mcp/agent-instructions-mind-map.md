
# worfy Mind map

Each topic of this Product Session lives in its own folder of the Product Session folder
(`docs/product/<topic>/`): the wayfinder map `map.md`, its Tickets `issues/NN-slug.md` (the large
nodes) and the Mind map `mind-map.json` (the small nodes). Change the Mind map only with the
`worfy-mind-map` tools, never by editing `mind-map.json`: the tools check the file's format before
they write, and the owner's screen redraws from it at once.

- `mind_map_read` lists the topics, or reads one: its map Tickets, its nodes and any format errors.
  Read a topic before you change it.
- `mind_map_add` adds one node: `idea`, `question`, `decision` or `objection`, a short `text`, and
  `from`, the node it grew out of — a node id, `ticket:NN` for a Ticket of the topic's map, or
  `null` for the topic itself. A decision needs `status` (`accepted` or `rejected`) and `reason`; an
  objection needs `source`, the fact it rests on (a document path, a Ticket, a PR, a URL). Set
  `advice: true` on an idea or objection you propose yourself: it counts in the share of accepted
  advice.
- `mind_map_decide` records the owner's decision on a node: `accepted` or `rejected`, always with the
  reason. A rejected decision stays on the map. Deciding again keeps the earlier status and reason in
  the node's history; `replaces` names the Decision a new one overturns.
- `mind_map_update` changes a node's text, kind, source or advice; a Decision changes only through
  `mind_map_decide`. `mind_map_remove` is for a node added by mistake: one without children, never a
  Decision.
- A refused call changes nothing: read its error, fix the arguments and call again.
- The owner moves nodes and folds branches by hand; you change what a node says, and only when the
  owner asks or agrees.
- When the owner asks to save, call `product_save`: the Project's Orchestrator then saves the
  changed `docs/product` files with a docs PR. You never run git yourself.
