---
type: regex
target: { source: file, path: .scratch/demo/stories/01-alpha.md }
pattern: '(?<![\s\S])(?=[\s\S]*^# Code story — demo 01: )(?=[\s\S]*^[^\n]*Kind: pr\b)(?=[\s\S]*^[^\n]*Language: ru\b)(?=(?:(?!^## )[\s\S])*^## 1\. Что было не так\r?$)(?=[\s\S]*^Code: )(?=[\s\S]*^- Что делает:)(?=[\s\S]*^- Почему здесь:)(?=[\s\S]*^- Без него:)(?=[\s\S]*^- Требование:)(?=[\s\S]*^- Риски и пробелы test-ов:)(?=[\s\S]*не записано)(?![\s\S]*Что нашёл review)'
flags: m
---

The story has the parts story-pr.md asks for, in Russian (the demo profile's language.reports): the title of
ticket 01, the header of a PR story, `Что было не так` as the first step, a code step with its fragment and the
five fields, `не записано` where the ticket gives no reason (it gives none for rounding down and for 0 on an empty
total), and no `Что нашёл review` step, which only the documents PR appends. The pattern is anchored at the start
of the file, so the negative check covers the whole story.
