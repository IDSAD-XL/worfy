---
type: regex
target: { source: file, path: verdict.md }
pattern: '^\uFEFF?(?:[ \t]*(?<f>(?<c>[`~])\k<c>{2,})(?!\k<c>)[^\n]*\n(?:(?![ \t]*\k<f>\k<c>*[ \t]*\r?\n)[^\n]*\n)*[ \t]*\k<f>\k<c>*[ \t]*\r?\n|(?![ \t]*(?:`{3}|~{3}))(?![ \t]*(?:#{1,6}[ \t]+)?(?<e>\*\*|__|\*|_|`)?(?:NARROW:[ \t]*)?(?:VERIFIED|REJECTED)(?:\k<e>(?![\p{L}\p{N}_/])|(?!\k<e>)(?![\p{L}\p{N}_/])))[^\n]*\n)*[ \t]*REJECTED:(?![^\n]*VERIFIED)'
flags: u
---

The saved answer's verdict is a bare `REJECTED:` (the tests fail although the report says exit code
0), and its line carries no second verdict: `VERIFIED` never shares the line with `REJECTED`. The
verdict line is the one every reader of a verdict takes (harness/lib/verdict.cjs, the owner's decision
of 2026-11-10): the first line that starts with the word `VERIFIED` or `REJECTED`, also behind a
heading mark, emphasis or a backtick, outside a fenced code block. The lines before it are a lead-in
and are skipped. The grader is stricter than the readers about that one line: it must be bare, so a
marked-up verdict (`**REJECTED**`, `## REJECTED`), a label in front of the word, a dash in place
of the colon, or a `VERIFIED` first fail the case even when a bare `REJECTED:` follows, because
the reviewer agent writes the verdict bare. Without the `m` flag `^` is the start of the answer,
and a later line may still say VERIFIED.
