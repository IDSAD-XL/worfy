# 07 — Шаблон сгенерированного skill-а и его запись в частную папку

Type: task
Status: open
Blocked by: 04, 06
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 2, 8, 9, 10; «Как работает» → «Частная папка», «Генератор», шаг 5, «Сгенерированный skill», «Проверка черновика» (форматы); «Сгенерированное и решения без владельца», п. 2–6; «Риски», п. 4, 5

Не платформенный: шаблон и текст skill-а; пишет файлы модель, скрипты готовые (Ticket-ы 03, 04). Глубина ревью —
`medium`.

## Что происходит

- После Ticket-а 06 генератор пишет `research.md`, но skill из него не собирает: шаг 5 — строка «not available yet».
- `review-draft-lint --skill` (Ticket 04) проверяет, что каждое правило ссылается на раздел `research.md`.
- `/worfy:code-review` ищет стандарты только в репозитории (`harness/skills/code-review/SKILL.md:34-36`) и даёт их
  списком в бриф оси Standards (`:62-66`).

## Что делаем

1. `harness/skills/human-review-setup/template/SKILL.md` — восемь разделов из spec, «Сгенерированный skill», с местами
   для правил; frontmatter `name: human-review`, описание «Draft a review of a pull request in this team's voice;
   nothing is posted without the user's yes». Шаг 3 зовёт `/worfy:code-review` и передаёт checklist команды как ещё
   один источник стандартов. Шаг 7 — файл черновика `{ payload, tiers, body_tier }` и `review-draft-lint`. Шаг 8 —
   отправка (`gh api … /pulls/<n>/reviews --input`) только после явного «да» в разговоре; без человека — стоп на
   черновике.
2. `template/voice-examples.md` — разделы по уровням; правило примеров: ссылка, без логина, не больше трети уровня от
   одного ревьюера при трёх и больше людях.
3. `template/lint.json` — пределы длины по уровням по умолчанию; генератор заменяет их 90-м перцентилем из
   `research.md`.
4. `harness/skills/human-review-setup/write.md` — шаг 5: заполнить шаблон из `research.md`, каждое правило кончается
   `[R<n>]`; записать в `<_resolved.dir>/state/human-review/.claude/skills/human-review/` и `lint.json` рядом с
   `research.md`; прогнать `review-draft-lint --skill`; находка — исправить и прогнать снова. Прежний skill, если есть,
   — в `previous/`.
5. `SKILL.md` генератора — шаг 5 вместо «not available yet»; `coverage.json` — новые файлы.

## Готово, когда

- [ ] Contract test: в `template/SKILL.md` восемь разделов в порядке решения владельца; уровни — те же семь, что в
      `analyse.md`.
  - evidence: test-run pass · `npx vitest run test/contract/harness-human-review-setup.test.ts` exit 0 · mac - · 8e4ed4dbd901d58ab5597faccd2f20d7c3f1a36f
- [ ] Contract test: шаг 8 шаблона не отправляет ничего без «да»; в тексте нет `gh pr review --approve` и нет
      отправки в ветке «no human in the session».
  - evidence: test-run pass · `npx vitest run test/contract/harness-human-review-setup.test.ts` exit 0 · mac - · 8e4ed4dbd901d58ab5597faccd2f20d7c3f1a36f
- [ ] Contract test: fixture, собранный по `write.md` (выдуманный `research.md`), проходит `review-draft-lint --skill`
      с exit 0; в `voice-examples.md` fixture-а нет логинов.
  - evidence: test-run pass · `npx vitest run test/contract/harness-human-review-setup.test.ts` exit 0 · mac - · 8e4ed4dbd901d58ab5597faccd2f20d7c3f1a36f
- [ ] `node scripts/check-cyrillic.mjs` и `node scripts/eval-harness.mjs --dry-run --changed origin/main` — exit 0.
  - evidence: test-run pass · `node scripts/check-cyrillic.mjs` exit 0; `node scripts/eval-harness.mjs --dry-run --changed origin/main` exit 0 · mac - · 8e4ed4dbd901d58ab5597faccd2f20d7c3f1a36f
- [ ] `ci-ok` на PR зелёный.

## Тесты

- `test/contract/harness-human-review-setup.test.ts` — разделы шаблона, запрет отправки, fixture сгенерированного
  skill-а через `review-draft-lint --skill`.
- Сначала падающий: fixture без `[R<n>]` у правила — красный.

## Где в коде

- `harness/skills/human-review-setup/SKILL.md`
- `harness/skills/human-review-setup/write.md` (новый)
- `harness/skills/human-review-setup/template/**` (новые)
- `harness/evals/lib/coverage.json`
- `test/contract/harness-human-review-setup.test.ts`

Только читать: `harness/bin/review-draft-lint`, `harness/skills/code-review/SKILL.md`.

## Итог

- Красный на старом поведении: новый `test/contract/harness-human-review-setup.test.ts` на `origin/main` dbe8e6cd5 —
  exit 1 (файлов шаблона нет); fixture без `[R<n>]` у правила — `review-draft-lint --skill` exit 1.
- `research.md` и `--skill`: skill собирается в `<частная папка>/raw/skill/` рядом с копией `research.md`, проверка
  `review-draft-lint --skill` идёт там, потом `SKILL.md` и `voice-examples.md` ставятся в `.claude/skills/human-review/`.
  Скрипт не менялся; `research.md` в папку skill-а не попадает.
- Шаблон назван `template/SKILL.template.md`, а не `template/SKILL.md`: файл `SKILL.md` во вложенной папке plugin-а
  может найти загрузчик skills (Codex ищет `SKILL.md` вглубь) как skill `human-review` с пустыми местами правил.
- `harness/bin/tests/start-context.test.sh`: папка частей рядом с `SKILL.md` называется с косой чертой на конце
  (`.../template/`) и проверяется как папка.
