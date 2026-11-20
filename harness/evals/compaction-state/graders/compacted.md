---
type: regex
weight: 3
target: trace
pattern: '"subtype"\s*:\s*"compact_boundary"'
match: count:1
---

The session was compacted exactly once, before the answer: the trace has one compact_boundary. The case
compacts only when the environment of the run has CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000 and
CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50 (a case may set only EVAL_* variables; `pnpm eval:harness -- --case
compaction-state` sets them); without them the agent answers from the whole history, and the other graders
measure nothing. A second compaction is a broken run as well: at a threshold under the context left after the
first one (as 5 % was) every later call compacted again, and the second summary already
held the questions of PROBES.md. Weight 3 against 1 for each of the other eight graders: a run without exactly
one compaction scores at most 8 / 11 = 0.73, below the threshold of 0.8, while one other grader that fails
leaves 10 / 11 = 0.91 and two leave 9 / 11 = 0.82.
