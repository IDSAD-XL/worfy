---
type: tool_used
tool: Edit
input_match: '^(?=[\s\S]*"file_path"\s*:\s*"[^"]*\.scratch/greet/issues/)[\s\S]*"new_string"\s*:\s*"(?:(?:[^"\\]|\\.)*?\\n)?(?:\*\*Status|Status: (?!(?:open|claimed|blocked|done)\b)|Status: open ?[^\\\d "])'
min: 0
max: 0
---

No Edit of a ticket file puts an old header into it: the text an Edit writes (`new_string`) has no
`**Status:**`, no Status word other than open, claimed, blocked or done, and no tail after the word.
What the Edit replaces (`old_string`) does not count.
