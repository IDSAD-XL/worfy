---
type: regex
pattern: '^[ \t]*— Stage: /to-tickets · demo 0/4 · ticket 01 — alpha: \S+ double[ \t]*$'
flags: m
---

The Stage line of the reply is the line bin/epic-status prints for the scaffold project: epic demo, none of
its four tickets done, ticket 01 (alpha) next. The hook stage-lines.mjs hands that line in with the prompt;
the typo fix changes no ticket status, so the line stays current. The ticket title is matched by `\S+`: the
fixture writes it in Russian, and the case files stay in English.
