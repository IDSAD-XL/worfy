---
description: Add a --json option to the command line tool and run the tests
runs: 10
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Bash, Write, Edit, Agent, Skill, TodoWrite, AskUserQuestion]
---

Please add a `--json` option to the textkit command line tool (`bin/textkit.mjs`). With it,
`textkit count` prints `{"count": <number>}` and `textkit top` prints an array of
`{"word": <word>, "count": <number>}` objects, in the same order as the text output. The option can
come before or after the file name. Without `--json` the output stays as it is now.

Then run the tests and tell me how it went.
