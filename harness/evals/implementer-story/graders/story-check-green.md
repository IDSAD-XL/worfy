---
type: regex
target: { source: file, path: .git/story-check.log }
pattern: '(?<![\s\S])(?=[\s\S]*^# Code story — demo 01: )(?=[\s\S]*^[^\n]*Kind: pr\b)(?=[\s\S]*^[^\n]*Language: ru\b)(?=(?:(?!^## )[\s\S])*^## 1\. Что было не так[ \t]*\r?$)(?=[\s\S]*^Code: )(?=[\s\S]*^- Что делает:)(?=[\s\S]*^- Почему здесь:)(?=[\s\S]*^- Без него:)(?=[\s\S]*^- Требование:)(?=[\s\S]*^- Риски и пробелы test-ов:)(?![\s\S]*Что нашёл review)(?=[\s\S]*^--- story-check ---\r?$[\s\S]*^in-branch: \.scratch/demo/stories/01-alpha\.md\r?$[\s\S]*\(branch demo/01\)[\s\S]*^EXIT=0\r?$)'
flags: m
---

The Code story of the PR is in the ticket branch, green and complete. The check of the fixture
(.git/eval-finish.sh, written by scaffold.sh), which the session starts after the implementer's report, writes
.git/story-check.log: the story `.scratch/demo/stories/01-alpha.md` as HEAD has it, then after
`--- story-check ---` the stories the branch `demo/01` added since main (`in-branch:`, from `git diff
main...HEAD`), the output of bin/story-check and its exit code (`EXIT=no-story` when HEAD holds no story).
The grader wants all of it:
- the parts story-pr.md asks for, in Russian (the demo profile's language.reports): the title of ticket 01, the
  header of a PR story, `Что было не так` as the first step, a fragment, the five fields of a code step, and no
  `Что нашёл review` step, which only the documents PR appends;
- the story added by the branch `demo/01` (`tickets.branch` of the demo profile, named by story-check's output);
- story-check exit 0: the fragments match the code of HEAD, every field is there, the branch is not the main
  branch.
The implementer's own story-check run is not what is graded. Not a git hook: Claude Code runs git with
repository hooks off. One grader, not three: a run scores the share of graders passed against the threshold
0.8, so with four graders any one that fails fails the case.
