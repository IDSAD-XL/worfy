---
type: regex
target: trace
pattern: 'reasoning_extraction|"stop_reason"\s*:\s*"refusal"|safeguards flagged this message|can.t help with this\. Start a new session'
match: not_contains
---

No refusal in the trace: no `reasoning_extraction` category, no `stop_reason` "refusal", and none of the texts
Claude Code shows for a refused request. story-pr.md asks for decisions and the evidence for them; a request for
a log of how the model thinks is what the API refuses as `reasoning_extraction`.
