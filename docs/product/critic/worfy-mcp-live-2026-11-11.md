# Critic: worfy-mcp-live — 2026-11-11

Plan: `.scratch/worfy-mcp-live/spec.md`
Verdict: Split — Ticket 02 does two separate jobs and holds back every other code ticket. Cut it into a status ticket and a pickup/Restart ticket, and narrow the spike to what earlier work has not already answered.

## Objections

### 1. The spike rebuilds a probe the repository already has and waits for the owner on questions an agent can answer

Fact: `scripts/spikes/harness-plugin/probe.ts:11` has the scenario `mcp-name` ("the plugin's `qmd` against allowedMcpServers"). Lines 22–24 say `install` and `mcp-name` "make no model call: they run in a sandbox (HOME and CLAUDE_CONFIG_DIR in a temporary directory, not logged in)". Its `mcpStatus` (`:383`) already calls `q.mcpServerStatus()`. `.scratch/worfy-polish/issues/100-*.md:89` records that this scenario was re-run on 2026-11-10 on SDK 0.3.322 ("без вызова модели, в sandbox"). `docs/adr/0048-harness-plugin-spike-results.md:121–122` already found that a server worfy registers in `mcpServers` (`source: dynamic`) is filtered by `allowedMcpServers` by name. Yet Ticket 01 step 2 writes a new probe "на одноразовой ветке (в `main` не вливается)", and step 5 says "Агент probe с настоящим Claude Code не запускает".

Judgement: Two of the three paths can be checked by an agent with no login and no model call: `claude mcp add` is a write into the sandbox `~/.claude.json`, and a name added to the list is a second `managedSettings`. Only the claude.ai connector needs the owner's account. So the owner gate before Wave 2 (spec "Риски", "до неё Wave 2 стоит") is needed for one path out of three. A throwaway branch also loses the scrubbing and `--rescrub` that the existing probe gives the fixtures, which the next SDK upgrade will need again.

Owner decision: принято 2026-11-11 («все да»)

### 2. Ticket 02 holds two independent changes, and its Restart ignores the existing rule against two processes on one transcript

Fact: Ticket 02 has 9 steps over 13 files. The status read path (row schema, `mcp` event, channels, `reconnect`/`turn-off`) sits in the same ticket as live pickup, `restart` and the Autopilot rule. The spec table (`spec.md:199–201`) blocks 03, 04 and 05 on all of 02. Step 6 says `restart` is "resume того же разговора". It names neither `SessionRegistry.start` (`src/main/agent/session/registry.ts:100–101`, which throws "Session … is already live" on resuming a live session, and takes an `after` promise to wait for) nor ADR-0064 ("Relaunch Orchestrator-а ждёт выхода старого процесса Claude Code"). `src/main/agent/orchestrator.ts:33–35` already does "starts the new Claude Code process only once the old one has exited … so two processes never continue one SDK session".

Judgement: The chip (03) and Codex (05) need only the read path. Under the current order they also wait for pickup and Restart, the riskiest part, whose shape depends most on the spike. A `restart` built from scratch either hits the "already live" error or repeats the 7-second overlap that ADR-0064 fixed. It should reuse the existing relaunch-after-exit path and say so in the ticket.

Owner decision: принято 2026-11-11 («все да»)

### 3. The "not allowed" rows rest on data that Claude Code does not report, and claude.ai connectors have no other source

Fact: In `test/fixtures/sdk-messages/plugin-mcp-name-user-qmd-no-allowlist.jsonl` the `system/init` `mcp_servers` lists `plugin:worfy:qmd`, `qmd` and `worfy-canvas`. In `plugin-mcp-name-user-qmd-allow-qmd.jsonl`, with the list in force, the server the list cut is missing (`qmd`, `worfy-canvas` only). `spec.md:137–138` leaves "откуда worfy берёт их имена" to the spike. `spec.md:250` still makes "Сервер вне `mcp.allowed` виден как «не разрешён в этом Project»" a Ready-when item.

Judgement: The existing capture already shows that Claude Code drops a server cut by the policy tier from `system/init`. worfy can find such a server only in files it reads itself (`~/.claude.json`, `.mcp.json`). A claude.ai connector is in none of those files. So the Allow button for a connector, which is user story 2 under the default list, may have nowhere to get its name. The spec should say now what a connector outside the list shows. Otherwise Ticket 02 step 7 and the Ready-when item above depend on an answer that may not exist.

Owner decision: принято 2026-11-11 («все да»)

## Alternative

01 adds a sandboxed `mcp-live` scenario to `scripts/spikes/harness-plugin/probe.ts`: write a server into the sandbox config while the query runs, then try `reloadPlugins`, `setMcpServers` and a second `managedSettings`, and record `mcpServerStatus`. The agent runs it. The owner's live check covers only the claude.ai connector. 02a: status read path, `reconnect`, `turn-off` (blocked by 01). Then 03 and 05 in parallel (blocked by 02a). 02b: pickup and `restart` over `SessionRegistry.start(…, after)` / ADR-0064 (blocked by 01, 02a). 04 blocked by 02b and 03. The spec's plan is still close: its tickets, seam and test seams stand. Only the cut of 02 and the scope of 01 change, so the same work gets the chip to the owner one Wave earlier.

## What the critic cannot know

- There is no product analytics. How many users add servers during a Session, or use claude.ai connectors with worfy, is not known.
- The captures were taken in a sandbox with no login. How Claude Code reports a claude.ai connector under `allowedMcpServers` was not checked.
- The claim in `spec.md:24` that terminal Claude Code picks up a server added by `claude mcp add` in the same session was not checked.
- Codex behaviour (`config/mcpServer/reload` in a thread already started) was read only from the protocol schema.
