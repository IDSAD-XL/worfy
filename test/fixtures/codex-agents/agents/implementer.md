---
name: implementer
description: Implements one ticket, with tests. Commands come from the profile (`${CLAUDE_PLUGIN_ROOT}/bin/profile`).
model: inherit
effort: high
experimental:
  cacheTtl: 1h
---

**First action — the project profile.** Run `${CLAUDE_PLUGIN_ROOT}/bin/profile` in the current directory.

Report "JSON" and nothing else.
