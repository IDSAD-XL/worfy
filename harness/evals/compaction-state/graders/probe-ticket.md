---
type: llm
focus: { source: file, path: answers/2-ticket.md }
---

Probe 2, the ticket. The text is the answer the agent wrote to answers/2-ticket.md, and nothing else of its reply. The answer names epic demo, ticket 01 (alpha), the
ticket file .scratch/demo/issues/01-alpha.md and the branch demo/01. Pass when all three are there: the
ticket (demo/01, or epic demo ticket 01), the file path (this path, or an absolute path that ends with it),
and the branch. Fail when one is missing or
wrong, for example another ticket of the epic (02 bravo, 03 charlie, 04 delta) or another branch.
