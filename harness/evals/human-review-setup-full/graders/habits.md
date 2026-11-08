---
type: llm
focus: { source: file, path: built/SKILL.md }
---

The fixture's team has two clear habits. Every migration without a down step got CHANGES_REQUESTED
(pull requests 24, 27 and 30: "every migration here must be reversible"), and the documentation and
dependency pull requests (26, 29) were approved without a single comment.

PASS if the skill has a rule that asks for a down (reversible) migration or blocks a migration without
one, and a rule that lets documentation, text or dependency changes through without comments; each such
rule may word it its own way and ends with a reference like `[R5]`.
FAIL if either rule is missing, or the skill names a login of the history (fern-lead, otter-qa,
quill-ops, drift-guest, sable-dev, wren-dev, ledger-ci).
