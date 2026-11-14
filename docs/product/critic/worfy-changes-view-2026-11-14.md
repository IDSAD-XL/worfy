# Critic: worfy-changes-view — 2026-11-14

Plan: `.scratch/worfy-changes-view/spec.md`
Verdict: Split — Ticket 03 holds the whole screen plus every way into it, and Ticket 04 holds a PR feature, "Since my last look", although PRs only arrive in Ticket 09. Both tickets need a cut before the waves stand.

## Objections

### 1. Ticket 04 builds the PR's "Since my last look" before Ticket 09 creates the PR subject, and Ticket 09 does not wait for 04

Fact: `.scratch/worfy-changes-view/spec.md:458` gives Ticket 04 "для PR — `seenHeadOid` из `pr-inbox.json`" with "Blocked by: 03". `:244` says the PR subject is "PR — Ticket 09". `:463` gives Ticket 09 "Blocked by: 03, 05", with no 04 and no mention of Since my last look. `:546` requires "у PR — All changes, Commit и Since my last look".

Judgement: Ticket 04 would have to wire `prInbox.markSeen` and a PR scope for a subject that does not exist yet, with no test or e2e path to prove it. Ticket 09 does not own the job, so the PR Since-my-last-look criterion can end up built twice or not at all. Move the PR part of 04 into 09 and add 04 to 09's `Blocked by:`. The waves table already puts 09 after 04, so no wave moves.

Owner decision:

### 2. Ticket 03 carries the diff screen and four separate entry changes; 04, 05 and 10 all wait for all of it

Fact: `.scratch/worfy-changes-view/spec.md:457` puts all of this into Ticket 03: the Node, tree, Inline and Side by side, Wrap, Hide whitespace, collapsed files, Workflow files group, keys and scope menu. It also adds the Ticket card action with a new chip line in `ticket-card.ts`, the Session Node badge, the rail block, and focus mode Main + side. `:279-281` says that last item changes `requestFocus` to take a preset. `:285-286` says the chip's counter updates "при сдвиге head ветки и в конце хода", which are the triggers Ticket 08 builds (`:462`, blocked by 03).

Judgement: the screen itself includes custom windowed rendering, written without a library (`:266-267`), and is already one implementer's full ticket. The four entries touch four other modules: the card layout, the badges, the session rail and focus mode. Tickets 04, 05 and 10 need only the Node, yet the whole of 03 blocks them. Cut 03 in two. 03a is the Node and screen, opened from the Ticket card action and the Command palette, with no live counter. 03b, in Wave 3 next to 04, 05 and 10, holds the Session badge, the rail block, the focus-mode preset, and the `+N −M` chip on the counter that Ticket 08 refreshes.

Owner decision:

### 3. The owner's month rule allows one new Epic at a time, chosen after an idea round; this draft is one of two new Epics drafted the same day

Fact: `docs/product/roadmap-worfy/issues/04-как-развивается-сам-worfy-в-этом-месяце.md:19-20` says "новый Epic — не больше одного за раз, выбранный после раунда идей", with "Revisit when: … почти законченные Epic-и закрыты; 2026-12-08" (`:27`). `.scratch/worfy-acceptance/spec.md:3` is a second draft from the same competitor research, dated 2026-11-13. `bin/epic-status` shows `worfy-ui-kit 14/19` and `worfy-mcp-live 9/11` still open; both were accepted on 2026-11-11. This spec depends on `worfy-ui-kit` (`spec.md:26-27`, ContextMenu kit, its Ticket 12, still `open`).

Judgement: the spec does not mention the rule. The rule's revisit conditions are not met: near-finished Epics are still open, and the date is before 2026-12-08. The owner has accepted Epics after 2026-11-08, so the rule may already be relaxed in practice. Either way, the owner should say so explicitly or choose between this draft and `worfy-acceptance`. Accepting both silently goes against a recorded decision. If the rule holds, this Epic starts after `worfy-ui-kit` closes, which also brings the ContextMenu kit it waits for.

Owner decision:

## Alternative

Two Epics instead of one with 12 tickets. The first is the core: prototype, read-only git reading, the Node with the Ticket entry, line comments sent in one message, docs and acceptance. That is 6–7 tickets, and the owner gets the main loop (read the diff, comment, send) after Wave 3. The second Epic comes after the owner has used the core. It holds Last turn for Claude and Codex, live refresh, Viewed and Since my last look, and PR diffs. The current plan is still a single coherent spec with sound premises: every file and line it cites was found as described. If the owner wants all of it in one Epic, objections 1 and 2 are enough to make its order hold.

## What the critic cannot know

- There is no product analytics. How often the owner and the two source-build users read diffs in GitHub, an editor or `git diff` is not known, so the value of each scope (Last turn, Since my last look, PR) cannot be ranked.
- Whether the one-new-Epic rule of 2026-11-08 still holds. Three Epics were accepted after it; no record of lifting it was found.
- How the Claude Code PreToolUse hook behaves on every interactive Session. The spec moves it from Autopilot-with-Auto-approval and Product Sessions to all Sessions. Its speed and side effects were not measured; only the SDK fields `agent_id` and `prompt_id` were confirmed in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:171-183`.
- The brief named the review file with the date 2026-11-13. `date +%F` printed 2026-11-14, and the file carries today's date.
