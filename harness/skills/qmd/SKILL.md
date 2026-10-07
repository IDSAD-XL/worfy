---
name: qmd
description: Search the decisions and lessons of registered projects through the qmd MCP server — ADRs, state files, tickets, project memory, lesson bases; which collections belong to whom is stated by the profiles (`~/.claude/profiles/*/profile.json`, field qmd). Use in Phase 0 and before planning a ticket, when you need to find out "why was it decided this way", "have we already stepped on this", or where the needed document lives. Contains the rules for sub-queries over Russian text.
---

# qmd: searching decisions and lessons

The index is global, one for all projects: config `~/.config/qmd/index.yml`, database
`~/.cache/qmd/index.sqlite`. Which collections belong to which project and what they hold is
stated by the project's profile (`~/.claude/profiles/<name>/profile.json`, field `qmd`: `collections`,
`covers`, `fallback_grep`; contract — `~/.claude/profiles/README.md`). Where a collection takes its
files from is in `index.yml`. One call prints both tables:

```bash
for f in ~/.claude/profiles/*/profile.json; do
  jq -r '"\(.name): \((.qmd.collections // []) | join(", ")) — \(.qmd.covers // "no qmd field")"' "$f"
done
awk '/^collections:/{c=1; next} c && /^[^ ]/{c=0} c && /^  [^ ]/{n=$1; sub(/:$/, "", n)} c && /^    path:/{print n "\t" $2}' ~/.config/qmd/index.yml
```

A profile's collections are a hint about where to expect the answer, not a filter: search the whole
index and do not pass them in the `collections` parameter as an exclusive list. Quirks of a specific
project's paths and copies (for example, that a collection is built from a copy of the main branch)
are in the `rules.md` of its profile: `"${CLAUDE_PLUGIN_ROOT}/bin/profile" --rules`.

The index is refreshed in the background at the start of every session (wrapper
`${CLAUDE_PLUGIN_ROOT}/bin/qmd-mcp`, log `~/.cache/qmd/refresh.log`); before that, a collection with
`update:` in `index.yml` pulls its own copy (`${CLAUDE_PLUGIN_ROOT}/bin/qmd-sync-main <profile>`), and
new files are embedded. The index is a snapshot taken at session start: read uncommitted changes and
work branches from the working tree.

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

- Where a project keeps its lessons is the profile's `lessons` field: `repo:<path>` — in the repository (Auction has
  `docs/lessons/<topic>.md`, ADR-0085; HANDOFF there holds only the current state), `profile` — in
  `~/.claude/profiles/<name>/lessons/` (Atakama, collection `lessons`).
- A hit in `memory/MEMORY.md` is the table of contents of the memory files: open the memory file itself.
- A new hybrid query costs 7–14 s, a repeat is instant. Do not run it one word at a time;
  put together one good call.
- The same from a terminal: `qmd query $'vec: …\nlex: …'`, `qmd get <path>` — from a directory without its own `.qmd/`.
