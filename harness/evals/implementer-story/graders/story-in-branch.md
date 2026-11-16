---
type: regex
target: { source: file, path: .git/story-check.log }
pattern: '^stories: \.scratch/demo/stories/01-alpha\.md$'
flags: m
---

A commit holds the Code story of the PR at the path of story-pr.md, `.scratch/demo/stories/01-alpha.md`. The
post-commit hook of the fixture (scaffold.sh) writes the stories of HEAD into .git/story-check.log after each
commit that holds one; no such commit, no file, and the grader fails.
