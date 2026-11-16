---
type: regex
target: { source: file, path: .git/story-check/01-alpha.md }
pattern: '(?<![\s\S])(?=[\s\S]*^# Code story — demo 01: )(?=[\s\S]*^[^\n]*Kind: pr\b)(?=[\s\S]*^[^\n]*Language: ru\b)(?=(?:(?!^## )[\s\S])*^## 1\. Что было не так[ \t]*\r?$)(?=[\s\S]*^Code: )(?=[\s\S]*^- Что делает:)(?=[\s\S]*^- Почему здесь:(?:[^\n]*\n[ \t]+)*?[^\n]*не записано)(?=[\s\S]*^- Без него:)(?=[\s\S]*^- Требование:)(?=[\s\S]*^- Риски и пробелы test-ов:)(?![\s\S]*Что нашёл review)'
flags: m
---

The story has the parts story-pr.md asks for, in Russian (the demo profile's language.reports): the title of
ticket 01, the header of a PR story, `Что было не так` as the first step, a code step with its fragment and the
five fields, `не записано` in the field `Почему здесь` (its value, continuation lines included), since the ticket
gives no reason for rounding down or for 0 on an empty total, and no `Что нашёл review` step, which only the
documents PR appends. It reads the copy of the story as the last commit that holds it has it, which the
post-commit hook of the fixture keeps in .git/story-check/, so the parts and story-check grade the same text. The
pattern is anchored at the start of the file, so the negative check covers the whole story.
