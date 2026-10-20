---
type: regex
pattern: '[ \t]*— Stage:[^\n]*\n[ \t]*— Now:[^\n]*\n[ \t]*— Next:[^\n]*\n[ \t]*— Waiting:[^\n]*(\n\s*)?$'
---

The final reply ends with the four status lines — Stage, Now, Next, Waiting, in this order, each
line indented or not.
