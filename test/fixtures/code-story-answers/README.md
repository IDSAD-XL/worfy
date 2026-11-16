# Code story answers

The shared Code story cases of `harness/bin/tests/fixtures/code-story/` as the JSON a Vendor's oneShot answers
with (`src/shared/stories/schema.ts`): `pr-en.json` is `pr-en.md`, `pr-ru.json` is `pr-ru.md`, `epic-ru.json` is
`epic-ru.md` — the same steps, fields and code. The epic fixture names no PR heads; `epic-ru.json` gives each
ready chapter an invented one (the PR number padded with zeros). `test/contract/story-one-shot.test.ts` checks
that every fragment here is the code of `harness/bin/tests/fixtures/code-story/repo/`, and the fake agent's
script `test/fixtures/agent-scripts/story.jsonl` answers with `pr-en.json`.
