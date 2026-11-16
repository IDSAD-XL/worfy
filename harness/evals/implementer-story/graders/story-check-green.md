---
type: regex
target: { source: file, path: .git/story-check.log }
pattern: '^EXIT=0$'
flags: m
---

bin/story-check exits 0 on the stories of the last commit that holds one: the fragments match the code of that
commit, every field is there, and the branch is not the main branch. The post-commit hook of the fixture runs it
and writes its exit code; the implementer's own run is not what is graded.
