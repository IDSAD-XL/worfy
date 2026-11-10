---
type: regex
target: { source: file, path: verdict.md }
pattern: '^(?:(?![ \t]*(?:NARROW:[ \t]*)?(?:VERIFIED|REJECTED)(?![\w/]))[^\n]*\n)*[ \t]*REJECTED:(?![^\n]*VERIFIED)'
---

The saved answer's verdict is a bare `REJECTED:` (the tests fail although the report says exit code
0), and its line carries no second verdict: `VERIFIED` never shares the line with `REJECTED`. Lines
before the first line that starts with the bare word `VERIFIED` or `REJECTED` are a lead-in and are
skipped, as every reader of a verdict skips them (the owner's decision of 2026-11-10). The grader is
stricter than the readers: harness/lib/verdict.cjs also reads a word behind a heading mark or
emphasis (`**REJECTED**`, `## REJECTED`), while here such a line, a label in front of the word, a
dash in place of the colon, or a `VERIFIED` first still fail the case, because the reviewer agent
writes the verdict bare. Without the `m` flag `^` is the start of the answer, and a later line may
still say VERIFIED.
