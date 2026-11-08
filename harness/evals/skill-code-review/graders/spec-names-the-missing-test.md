---
type: regex
pattern: '^#{1,3}[ \t]*Spec\b(?:(?!^#{1,3}[ \t]*Standards\b)[\s\S])*?alpha\.test'
flags: m
---

The Spec part of the final reply — from its heading to the Standards heading or the end — names the
test `test/alpha.test.mjs` that ticket 01 asks for and the change does not add. CODING_STANDARDS.md
says nothing of tests, so this defect belongs to the Spec axis only.
