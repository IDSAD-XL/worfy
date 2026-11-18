---
description: 'After a compaction, an implementer still knows its goal, its ticket, the state of each done item, the files it touched, the decisions taken and its next step: the summary instructions (hooks/rules/compaction.md, PreCompact) and the state the hook of the compact branch hands back (hooks/after-compact.mjs). The history (history.jsonl) is resumed and compacted before the first answer by a low auto-compaction threshold, CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000 and CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=5. A case may set only EVAL_* variables, so `pnpm eval:harness` sets these two in the call of this case alone: the tag alone runs only by `--case compaction-state`, and a general run or --changed skips it with a note. Without them the grader compacted fails the case. The variant without the hook and the instructions is the copy of the Harness that baseline.mjs makes (HARNESS_DIR).'
tags: [alone]
runs: 3
max_turns: 6
timeout_seconds: 900
allowed_tools: [Read]
disallowed_tools: [Bash, Write, Edit, Glob, Grep, Agent, Skill, NotebookEdit, WebFetch, WebSearch, TodoWrite]
---

Прочитай файл `PROBES.md` в текущей папке и ответь на его вопросы. Других файлов не открывай и команд не запускай.
