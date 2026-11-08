---
type: regex
pattern: '^#{1,3}[ \t]*Standards\b(?:(?!^#{1,3}[ \t]*Spec\b)[\s\S])*?(?:export default|JSDoc)'
flags: m
---

The Standards part of the final reply — from its heading to the Spec heading or the end — names a
breach of CODING_STANDARDS.md: the `export default` of `src/alpha.mjs` or its missing JSDoc line.
