---
type: regex
target: trace
pattern: '"subtype"\s*:\s*"compact_boundary"'
---

The session was compacted before the answer: the trace has a compact_boundary. The case compacts only when
the shell that starts the run sets CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000 and
CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=5 (a case may set only EVAL_* variables); without them the agent answers from
the whole history, and the other graders measure nothing.
