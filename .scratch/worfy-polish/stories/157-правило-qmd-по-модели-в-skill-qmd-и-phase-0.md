# Code story — worfy-polish 157: Правило qmd по модели в skill `worfy:qmd` и Phase 0: Opus и Sonnet сначала `grep`, Haiku сначала `qmd`

Kind: pr · Epic: worfy-polish · Ticket: 157 · PR: - · Language: ru

## 1. Что было не так

Тексты Harness велели начинать поиск с `qmd` всегда: skill `worfy:qmd` звал себя «in Phase 0 and before planning
a ticket» для любой модели, scout называл `grep` поиском «only by letters». Замер 2026-11-26 этого не подтвердил:
на Sonnet ничья по точности и `grep` в 6 раз быстрее, на Haiku `qmd` впереди (27 из 30 против 21 из 30).

- Требование: [Что происходит](../issues/157-правило-qmd-по-модели-в-skill-qmd-и-phase-0.md#что-происходит)

## 2. Правило по модели в начале skill-а

Code: `harness/skills/qmd/SKILL.md:8-17` · key lines: 10, 12, 14

```markdown
## grep or qmd first — by model

- **Opus and Sonnet** search with `grep` (or `rg`, `find`) first. Go to `qmd` when `grep` found
  nothing, or when the question is "was there already a lesson" or "why was it decided this way".
- **Haiku** starts with `qmd`.

The rule comes from a measure of 2026-11-26: on Sonnet the two tied on accuracy and `grep` was six
times faster (92 s against 564 s) and cheaper in tokens; on Haiku `qmd` won, 27 of 30 against 21 of
30, and 8 against 5 on "symptom → lesson" questions. The sample was small; the measure is repeated
on real session questions.
```

- Что делает: Opus и Sonnet ищут сначала `grep` (`rg`, `find`) и идут к `qmd`, когда `grep` ничего не нашёл или
  вопрос — «был ли урок», «почему так решили»; Haiku начинает с `qmd`. Строка о замере с цифрами и о пересмотре.
  Поле `description` (строка 3) говорит то же коротко.
- Почему здесь: Ticket называет `harness/skills/qmd/SKILL.md` в «Где в коде» и просит правило в начале, до раздела
  «Where qmd comes from».
- Без него: сильная модель тратит время и token-ы на `qmd` там, где `grep` даёт тот же ответ в 6 раз быстрее.
- Требование: [Что строить, п. 1](../issues/157-правило-qmd-по-модели-в-skill-qmd-и-phase-0.md#что-строить)
- Риски и пробелы test-ов: правило — текст для модели; test-а, который проверяет, что агент ему следует, нет, а eval
  skill-а `qmd` не имеет cases (`harness/evals/lib/coverage.json`).

## 3. Phase 0: поиск перед scout-ом остаётся `qmd`

Code: `harness/hooks/rules/orchestrator.md:46-49` · key lines: 46, 47

```markdown
Before that agent goes out, run one `qmd` search on the ticket's subject, on any model: "is there
a decision or a lesson already" is where `qmd` pays off (skill `worfy:qmd`: ADRs, state-file
lessons, closed tickets, memory) — when the profile lists at least one `qmd.collections` entry.
With no collections or no profile, skip it and say so. What it finds changes the brief.
```

- Что делает: один поиск `qmd` перед scout-ом — на любой модели, потому что его вопрос «есть ли уже решение или урок»
  и есть случай, где `qmd` окупается по правилу шага 2.
- Почему здесь: Ticket оставляет выбор агенту (п. 2 «Что строить»); решение записано в «Итог». Абзац переписан
  короче, а не дополнен: правила Orchestrator-а упираются в предел 10 000 знаков test-а `rules-hooks.test.sh`
  (после правки 9 992).
- Без него: Orchestrator на Opus мог бы прочесть правило skill-а как «сначала `grep`» и для этого поиска тоже.
- Требование: [Что строить, п. 2](../issues/157-правило-qmd-по-модели-в-skill-qmd-и-phase-0.md#что-строить)
- Риски и пробелы test-ов: test проверяет только слова раздела (`read-only`, `entry points`, `call chain`,
  `exact files to touch`, `qmd.collections`) и размер, не смысл.

## 4. Scout: другой поиск — сначала `grep`

Code: `harness/agents/scout.md:41-43` · key lines: 42, 43

```markdown
3. Documents first, code second: for "why was this decided" and "have we hit this before" **start
   with `qmd`**: it answers by meaning. Any other search starts with `grep` (or `rg`, `find`) and
   goes to `qmd` when they find nothing (the model rule of skill `worfy:qmd`). The collections in
```

- Что делает: вопросы «почему решили» и «был ли урок» scout по-прежнему начинает с `qmd`; любой другой поиск — с
  `grep`, к `qmd` идёт, когда тот ничего не нашёл. Фраза «`grep` only by letters» убрана.
- Почему здесь: Ticket называет `harness/agents/scout.md:41-45`; scout работает на Sonnet (`model: sonnet`).
- Без него: scout противоречил бы правилу skill-а для своей модели.
- Требование: [Что строить, п. 3](../issues/157-правило-qmd-по-модели-в-skill-qmd-и-phase-0.md#что-строить)
- Риски и пробелы test-ов: не проверяется test-ом.

## 5. Что сознательно не меняли

`harness/agents/implementer.md`, `harness/skills/ship-ticket/SKILL.md` и `harness/skills/epic-wave/SKILL.md`: их
единственный вызов `qmd` перед планом — вопрос «есть ли уже решение или урок», случай `qmd` для любой модели;
правилу они не противоречат. Запасной `grep` по `qmd.fallback_grep`, когда сервера нет, — как был.

## 6. Как проверено

`bash harness/hooks/tests/rules-hooks.test.sh` — сначала exit 1: первый вариант абзаца дал 10 166 знаков
при пределе 10 000; после сокращения — 9 992 знака, exit 0 (382 passed). `bash harness/bin/tests/skill-blocks.test.sh` — exit 0 (86 passed),
`bash harness/bin/tests/harness-home.test.sh` — exit 0. Contract test-ы, которые читают тексты Harness
(`harness-plugin`, `harness-third-party-skills`, `harness-evals`, `harness-evals-run`, `harness-drift`,
`workflow-profile`, `check-cyrillic`) — exit 0. `pnpm lint`, `pnpm typecheck` — exit 0; gate fast — exit 0, green.

## Проверить себя

1. Почему поиск Phase 0 остался `qmd` даже на Opus?
   - Ответ: его вопрос — «есть ли уже решение или урок по теме», а правило отдаёт такие вопросы `qmd` на любой модели.
   - Строки: `harness/hooks/rules/orchestrator.md:46-47`
2. Когда Sonnet-scout идёт к `qmd` при поиске, где лежит код?
   - Ответ: только когда `grep`, `rg` или `find` ничего не нашли.
   - Строки: `harness/agents/scout.md:42-43`

## 7. Что нашёл review и что осталось

> VERIFIED — worfy-polish 157 (a search rule by model in skill worfy:qmd: Opus and Sonnet start with grep and go to qmd when grep finds nothing or for «was there a lesson / why decided»; Haiku starts with qmd; Phase 0 keeps one qmd search on any model, since «is there a decision or lesson already» is that case; scout searches the same way), head a7899c4f0f0ec1e3eb2ff912a536453ac14b3dc9
>
> Gate (depth low: Harness text only, 3 files, no code): diff read by the orchestrator against the owner's decision of 2026-11-26 (Q3) — matches. Phase 0 stays qmd on any model (decision taken alone, recorded in the ticket; it is the «was there a lesson» case of the rule).
> Evidence: rules-hooks.test.sh exit 0 (382 passed; orchestrator rules 9992 of 10000 chars), skill-blocks.test.sh and harness-home.test.sh exit 0, harness contract tests exit 0, lint, typecheck exit 0, gate fast green, story-check exit 0. Windows scope: runner.
> Not verified: whether models follow the rule (no eval case for skill qmd; no paid eval run).
