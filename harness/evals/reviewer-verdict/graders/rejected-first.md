---
type: regex
target: { source: file, path: verdict.md }
pattern: '^REJECTED:(?!.*VERIFIED)'
---

The saved answer starts with `REJECTED:` (the tests fail although the report says exit code 0), and
its first line carries no second verdict: `VERIFIED` never shares the line with `REJECTED`. Without
the `s` flag `.` stops at the end of the line, so a later line may still say VERIFIED.
