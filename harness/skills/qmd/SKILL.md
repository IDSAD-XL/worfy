---
name: qmd
description: Search the decisions and lessons of registered projects through the qmd MCP server — ADRs, state files, tickets, project memory, lesson bases; which collections belong to whom is stated by the profiles (`~/.claude/worfy-harness/projects/*/profile.json`, field qmd). Use in Phase 0 and before planning a ticket, when you need to find out "why was it decided this way", "have we already stepped on this", or where the needed document lives. Contains the rules for sub-queries over Russian text.
---

# qmd: searching decisions and lessons

The index is global, one for all projects: config `~/.config/qmd/index.yml`, database
`~/.cache/qmd/index.sqlite`. Which collections belong to which project and what they hold is
stated by the project's profile (`~/.claude/worfy-harness/projects/<name>/profile.json`, during the
transition also `~/.claude/profiles/<name>/`; field `qmd`: `collections`, `covers`,
`fallback_grep`; contract — `${CLAUDE_PLUGIN_ROOT}/profiles/README.md`). Where a collection takes its
files from is in `index.yml`. One call prints both tables:

```bash
for d in "${HARNESS_HOME:-$HOME/.claude/worfy-harness}/projects" "$HOME/.claude/profiles"; do
  find "$d" -mindepth 2 -maxdepth 2 -name profile.json 2>/dev/null | sort
done | while read -r f; do
  jq -r '"\(.name): \((.qmd.collections // []) | join(", ")) — \(.qmd.covers // "no qmd field")"' "$f" | tr -d '\r'
done
awk '/^collections:/{c=1; next} c && /^[^ ]/{c=0} c && /^  [^ ]/{n=$1; sub(/:$/, "", n)} c && /^    path:/{print n "\t" $2}' ~/.config/qmd/index.yml
```

A profile's collections are a hint about where to expect the answer, not a filter: search the whole
index and do not pass them in the `collections` parameter as an exclusive list. Quirks of a specific
project's paths and copies (for example, that a collection is built from a copy of the main branch)
are in the `rules.md` of its profile: `"${CLAUDE_PLUGIN_ROOT}/bin/profile" --rules`.

The index is refreshed in the background at the start of every session (wrapper
`${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp`, log `~/.cache/qmd/refresh.log`) and after a turn when the main
branch has moved (Stop hook `qmd-refresh --quiet`); before that, a collection with `update:` in
`index.yml` pulls its own copy (`${CLAUDE_PLUGIN_ROOT}/bin/qmd-sync-main <profile>`), and new files
are embedded. The index is a snapshot taken at session start: read uncommitted changes and work
branches from the working tree.

## Where qmd comes from

qmd is part of the Harness. You do not install it, download models or add
collections yourself: each of these steps needs the user's consent or writes outside the project.

- **The server.** The plugin declares it in `${CLAUDE_PLUGIN_ROOT}/.mcp.json` as `qmd`; its tools
  are `mcp__plugin_worfy_qmd__query`, `__get`, `__multi_get`, `__status`. Sessions that worfy starts
  register the same command themselves as `plugin_worfy_qmd`, with the same tool names.
- **The program.** `qmd` 2.8.3 (the version is pinned; the scripts rely on its behaviour), installed
  by worfy with `npm install -g @tobilu/qmd@2.8.3` after the user agrees. It needs node 22 or newer.
- **The models** (about 2.4 GB) are downloaded only after the user agrees, by `qmd pull` with the
  models of `qmd-mcp`; the Russian query expansion model replaces the default one when some project
  has `language.docs: ru`. The answer is the file `~/.claude/worfy-harness/qmd-models`: the first
  line `downloaded` or `skipped`, then the downloaded models. Without `downloaded` `qmd-mcp` exits
  with one line in stderr and the server does not start (otherwise qmd would download the models
  itself on the first query), and `qmd-refresh` runs `qmd update` but not `qmd embed`. Plain word
  search (`qmd search`, BM25) needs no models.
- **The collections** of a project are added by `${CLAUDE_PLUGIN_ROOT}/bin/qmd-collections <profile>`
  (worfy runs it when a project is connected and on its first-run screen): `<profile>-docs` (ADRs,
  CONTEXT, HANDOFF and lessons from the profile's `docs.*` and `lessons`), `<profile>-tickets`
  (`.scratch/`) and `<profile>-memory` (Claude's memory of the project). In Full mode they are read
  from a git copy of the main branch (`~/.cache/qmd/<profile>-<branch>`), in Silent mode from the
  Workflow folder. The script writes the names into `qmd.collections` and a description into
  `qmd.covers` of the profile, never into the project's repository; a second run changes nothing.
- **No server in the session** (no `mcp__plugin_worfy_qmd__*` tools, or `status` fails): search with
  `grep` over the profile's `qmd.fallback_grep` and say in the report that qmd was not available.

## Server tools

- `query` — hybrid search (BM25 + vector + rerank). Pass `searches`
  (typed sub-queries, up to 10), not a `query` string: the parameters are mutually exclusive,
  and auto-expansion on Russian text (checked 2026-09-06) is weaker than sub-queries written for the question.
  Text answer: `#docid score path - title` per result. `structuredContent`
  additionally has `line` (the line of the best fragment) and `snippet`; if you do not see them,
  fetch the fragment with `get` by `#docid`.
- `get` — a document or a fragment: `file` = the path from the results as is, or `#docid`;
  `fromLine`, `maxLines`. Take 40–80 lines around the hit, not the whole file.
- `multi_get` — several files: parameter `pattern` (glob, comma-separated list or docid);
  large files are skipped; do not read `HANDOFF.md` through it.
- `status` — collections, document counts, documents waiting to be embedded.
- Extra `query` parameters: `limit` (5–8 is enough), `collections: ["memory", "lessons"]`
  (an array; the singular `collection` is silently ignored), `intent` (context for
  disambiguation, does not search by itself), `minScore`, `rerank: false` (faster, but worse ordering).

## How to write `searches` for Russian text

One call, 3–5 sub-queries, the first one weighs double:

1. `vec` — the question in your own words, whole:
   «почему отказались от websocket и живого обновления страницы».
2. `lex` — 2–4 word stems without endings: `сторож выкат документн`. Matching is
   by prefix, no asterisk needed. Do not write a sentence: terms are combined with AND,
   one extra word zeroes the results. There is `"exact phrase"` (no prefix matching) and `-word`
   for exclusion (only next to a positive term). English identifiers
   (`staleTime`, `legal_lock`) go in a separate lex line; hyphenated ones (`verify-deploy`)
   are searched as an exact phrase, without prefix matching.
3. `hyde` — one or two sentences that look like the expected answer: «От WebSocket отказались,
   потому что у api нет домена; если понадобится живость — SSE со страницы лота».
4. A second `lex` with synonyms, when the topic has two names (смоук / дымовые проверки / verify-deploy).

Example call:

```json
{"searches": [
  {"type": "vec",  "query": "почему сторож выката ждёт бесконечно после документного мержа"},
  {"type": "lex",  "query": "сторож выкат документн"},
  {"type": "hyde", "query": "Сторож выката ждёт по коммиту, а не по последнему прогону: документный мерж сдвигает последний прогон, и ожидание не завершается"}
], "limit": 6}
```

## What to keep in mind

- Where a project keeps its lessons is the profile's `lessons` field: `repo:<path>` — in the repository (for example
  `docs/lessons/<topic>.md`; the state file then holds only the current state), `profile` — in
  `~/.claude/worfy-harness/projects/<name>/lessons/` (in the index only if the user set up a collection for it).
- A hit in `memory/MEMORY.md` is the table of contents of the memory files: open the memory file itself.
- A new hybrid query costs 7–14 s, a repeat is instant. Do not run it one word at a time;
  put together one good call.
- The same from a terminal: `qmd query $'vec: …\nlex: …'`, `qmd get <path>` — from a directory without its own `.qmd/`.
