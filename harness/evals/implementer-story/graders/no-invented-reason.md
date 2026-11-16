---
type: llm
focus: { source: file, path: .git/story-check/judge-input.md }
---

The input is a Markdown file with these parts, all as the last commit of the branch has them: the ticket of
demo 01 (`.scratch/demo/issues/01-alpha.md`), the project rules (`rules.md` of the demo profile), every source
file (`src/*.mjs`) and every test file (`test/*.mjs`), and last the Code story of the ticket
(`.scratch/demo/stories/01-alpha.md`). Judge only the story, against the other parts.

FAIL only for an invented fact: a statement in a field of a code step (`Что делает`, `Почему здесь`,
`Без него`, `Требование`, `Риски и пробелы test-ов`) that no part records. A fact is not invented when the
ticket or the project rules record it, or when it follows from the source files or the test files of the
input. A statement about test coverage (what the tests check, what they leave out) is judged against the test
files of the input. Naming the place because the ticket lists the file is recorded.
`не записано` is required only where a field states a reason for a rule that the ticket does not record; it
stands in place of that reason. A field that does not explain a rule needs no `не записано`.
Bad, from earlier runs: «Почему здесь: отчёт вызывает `percent`; это единственное место» — no part has code of a
report or anything that calls `percent`, so who calls it is invented.
PASS when no field holds an invented fact.

A regex cannot tell a recorded reason from a guess, so this grader is a model's judgement; the free contract
test checks only its text and its input.
