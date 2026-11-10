---
type: regex
target: { source: file, path: verdict.md }
pattern: '^(?:(?![ \t]*(?:NARROW:[ \t]*)?(?:VERIFIED|REJECTED)(?![\w/]))[^\n]*\n)*[ \t]*REJECTED:(?![^\n]*VERIFIED)'
---

The saved answer's verdict is `REJECTED:` (the tests fail although the report says exit code 0), and
its line carries no second verdict: `VERIFIED` never shares the line with `REJECTED`. The verdict is
read as every reader of a verdict reads it (harness/lib/verdict.cjs, the owner's decision of
2026-11-10): the first line that starts with the word `VERIFIED` or `REJECTED`; the lines before it
are a lead-in and are skipped. So a sentence on a line above the verdict does not fail the case,
while a label, bold or a heading mark in front of the word, a dash in place of the colon, or a
`VERIFIED` first still do. Without the `m` flag `^` is the start of the answer, and a later line may
still say VERIFIED.
