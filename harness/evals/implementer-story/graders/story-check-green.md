---
type: regex
target: { source: file, path: .git/story-check.log }
pattern: '^in-branch: \.scratch/demo/stories/01-alpha\.md\r?$[\s\S]*^EXIT=0\r?$'
flags: m
---

The branch adds the Code story of the PR at the path of story-pr.md, `.scratch/demo/stories/01-alpha.md`
(`in-branch:`, from `git diff main...HEAD`), and bin/story-check exits 0 on the stories of the last commit that
holds one: the fragments match the code of that commit, every field is there, the branch is not the main branch.
The post-commit hook of the fixture (scaffold.sh) writes both into .git/story-check.log, replaced at each such
commit; the implementer's own story-check run is not what is graded. One grader, not two: a run scores the share
of graders passed against the threshold 0.8, so with four graders any one that fails fails the case, and a red
story-check must.
