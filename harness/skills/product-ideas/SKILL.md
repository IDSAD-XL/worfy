---
name: product-ideas
description: Suggest three to five product ideas for what to build next, each with whom it is for, why now, a cost in tickets and how to tell it worked, at least one of them against the current roadmap, and put each on the topic's Mind map. Use when the product owner asks for ideas, "what next", "what should we build", or "what are we missing".
---

# Product ideas

You suggest; the product owner decides. Ideas are advice: no epic, ticket or code comes out of this
skill.

## 1. Read before you suggest

Two folders first. In Silent mode (`"${CLAUDE_PLUGIN_ROOT}/bin/profile" --field _resolved.mode`
prints `silent`) both lie in the Workflow folder, outside the repository, so a path read from the
repository root finds nothing there.

- The tickets root: `"${CLAUDE_PLUGIN_ROOT}/bin/ticket" root` prints its absolute path. Only when it
  fails, `.scratch/` of the repository.
- The product folder: `docs/product/` of the repository; in Silent mode `<Workflow folder>/product/`,
  where the Workflow folder is what
  `"${CLAUDE_PLUGIN_ROOT}/bin/profile" --field _resolved.workflow_folder` prints. The topic folder is
  `<product folder>/<topic>/`.

Then read what the project has decided and planned, so that an idea builds on it or argues with it:

- The roadmap: `docs/roadmap.md`, `ROADMAP.md`, or the roadmap section of the README. Glob for
  `**/roadmap*.md` and `**/ROADMAP*.md` when none of them exists. No roadmap: say so, and treat the
  next epic in line as the plan.
- Specs, accepted and draft: `<tickets root>/*/spec.md`, and the epic drafts of
  `<product folder>/*/drafts/`.
- Open tickets: the `Status:` lines of `<tickets root>/*/issues/*.md`, or
  `"${CLAUDE_PLUGIN_ROOT}/bin/epic-status"`.
- The topic: the topic folder (`map.md`, its tickets, research notes) and its Mind map,
  `mind_map_read` with the `topic`.
- Issues and pull requests on GitHub, `gh issue list` and `gh pr list`, when you have a shell and `gh`
  answers.

An idea that rests on a fact outside the repository (what another product does, what an API allows)
gets the fact first: call the Skill tool with `worfy:research`, and save its note into the topic
folder.

## 2. Three to five ideas

Each idea in this format, the labels in English as written:

```markdown
### Idea <N>: <one line: what to build>

- For whom: <who gains, by name of the role or the user group>
- Why now: <what makes it timely, with a fact: a path, a ticket, a PR, an issue or a URL>
- Cost: <a rough number of tickets, such as "about 3 tickets">
- How we will know it worked: <what the owner can see or count afterwards>
- Grew from: <the Mind map node, the ticket of the topic's map, or the topic itself>
- Against the roadmap: <the roadmap item, quoted, with its path; only on such an idea>
```

At least one idea goes against the current roadmap: it would replace, reorder or drop a planned
item. Its `Against the roadmap:` line quotes that item and says what the idea would change. An idea
that only adds to the plan is not one.

No idea without a `Why now:` fact. An idea you cannot ground in a fact is a question for the owner;
ask it as one.

## 3. Put each idea on the Mind map

Each idea becomes one node: `mind_map_add` with

- `topic` — the topic folder name;
- `kind` — `idea`;
- `text` — the heading line of the idea;
- `from` — the id of the node it grew from, `ticket:NN` for a ticket of the topic's map, or `null`
  for the topic itself;
- `advice: true` — you proposed it.

Add the nodes once the ideas are settled and before the final reply, one per idea, in the order of
the reply.

No `mind_map_*` tools in this Session (it is not a Product Session), or no topic folder: give the
ideas in the reply only, and say that they are not on the Mind map. Do not write `mind-map.json`
yourself.

## 4. Say what you do not know

End the reply with a short section "What I do not know". There are no product analytics: which
feature anyone uses, and how often, is unknown, and so is revenue. Name what an idea assumes about
usage, as a question for the owner, instead of guessing.

## 5. Stop at the ideas

The owner answers. When the owner accepts or rejects an idea, record it with `mind_map_decide`
(`accepted` or `rejected`, with the reason in the owner's own words). Draft an epic only after the
owner says yes to an idea and asks for the draft: then use `worfy:to-spec`, and the draft goes into
`drafts/<epic>.md` of the topic folder, not into the tickets root. Without that yes, write no draft,
no ticket and no code.
