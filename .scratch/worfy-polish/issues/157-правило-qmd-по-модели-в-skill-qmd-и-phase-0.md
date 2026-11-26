# 157 — Правило qmd по модели в skill `worfy:qmd` и Phase 0: Opus и Sonnet сначала `grep`, Haiku сначала `qmd`

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-11-26, второй раунд (Q1–Q6, «все да»), Q3; замер qmd против `grep` 2026-11-26 (три
прогона: 30 вопросов, затем 35 вопросов на Sonnet и на Haiku).

Кто: агент.

## Что происходит

`qmd` — локальный поиск по смыслу над ADR, Ticket-ами, файлами состояния, памятью и уроками (MCP-сервер плагина
worfy). Тексты Harness велят начинать с него всегда:

- Phase 0 правил Orchestrator-а — «Before that agent goes out, run one search of the qmd index on the ticket's subject»
  (`harness/hooks/rules/orchestrator.md:39-50`, раздел «Phase 0 — map before touching anything»);
- skill `worfy:qmd` (`harness/skills/qmd/SKILL.md`): «Use in Phase 0 and before planning a ticket»; про `grep` — только
  как запасной путь, когда сервер `qmd` недоступен (`:69`).

Замер 2026-11-26 этого не подтвердил:

- **Sonnet** — ничья по точности; `grep` в 6 раз быстрее (второй прогон: 92 с против 564 с) и тратит меньше token-ов.
- **Haiku** — `qmd` заметно впереди: 27 из 30 против 21 из 30; на вопросах «симптом → урок» — 8 против 5.
- Сильная модель сама делает смысловую работу: переводит вопрос, угадывает формулировку, пачкой гоняет `grep`. `qmd`
  окупается у слабой модели и на вопросах «был ли урок», «почему так решили».

Выборка маленькая — это не окончательный вывод, поэтому через месяц замер повторяется на настоящих вопросах.

## Что строить

1. **Правило по модели** в skill `worfy:qmd` (`harness/skills/qmd/SKILL.md`), в начале, до раздела о том, откуда
   берётся `qmd`:
   - Opus и Sonnet ищут сначала `grep` (или `rg`, `find`); к `qmd` идут, когда `grep` ничего не нашёл, или когда вопрос
     — «был ли уже урок», «почему так решили»;
   - Haiku начинает с `qmd`;
   - одна строка — откуда правило (замер 2026-11-26, цифры выше) и что его пересматривают.
   Поле `description` skill-а говорит то же коротко: сейчас оно зовёт skill «in Phase 0 and before planning a ticket»
   для любой модели.
2. **Phase 0** правил Orchestrator-а (`harness/hooks/rules/orchestrator.md:46-50`): один поиск перед scout-ом
   остаётся для вопроса «есть ли уже решение или урок по теме Ticket-а» — это и есть случай, где `qmd` окупается.
   Агент решает, оставить ли его `qmd` для любой модели или сделать по правилу п. 1, и пишет решение в «Итог».
3. **Остальные тексты Harness, которые говорят «сначала qmd»**, сверить с правилом и поправить, где расходятся:
   - `harness/agents/scout.md:41-45` — «start with `qmd`… `grep` only by letters»; scout работает на Sonnet
     (`model: sonnet`, `:5`), то есть под правило «сначала `grep`»;
   - `harness/agents/implementer.md:113-115`;
   - `harness/skills/ship-ticket/SKILL.md:122-125`, `harness/skills/epic-wave/SKILL.md:263-265` — один вызов `qmd`
     перед планом.
4. **Пересмотр через месяц.** Ticket того же Epic-а на повторный замер на настоящих вопросах сессий (не на
   придуманном наборе) — агент пишет его в «Итог» как предложение с датой не раньше 2026-12-26; Ticket заводит
   Orchestrator.
5. Текст Harness — только по-английски (ADR-0074).

## Где в коде

- `harness/skills/qmd/SKILL.md` — skill `worfy:qmd` (`:1-4` — `description`, `:42` — «Where qmd comes from», `:69` —
  запасной `grep`).
- `harness/hooks/rules/orchestrator.md:39-50` — Phase 0.
- `harness/agents/scout.md:41-45`, `harness/agents/implementer.md:113-115`, `harness/skills/ship-ticket/SKILL.md:122-125`,
  `harness/skills/epic-wave/SKILL.md:263-265`.
- Test: `harness/hooks/tests/rules-hooks.test.sh:591` проверяет, что раздел Phase 0 содержит `read-only`, `entry points`,
  `call chain`, `exact files to touch` и `qmd.collections`; правка Phase 0 не должна их терять или правит test вместе с
  текстом.
- `harness/profiles/README.md:224` — `qmd.fallback_grep` (пути для `grep`, когда `qmd` молчит); смысл поля не меняется.
- [ADR-0074](../../../docs/adr/0074-harness-neutral-by-language-and-project.md) — Harness без языка и без проекта.

## Решения

- Правило — про модель агента, а не про проект: Harness остаётся нейтральным к проекту (ADR-0074).
- Тексты Harness — правила для моделей; правка одного абзаца не меняет поведения кода, поэтому evals не нужны. Если
  агент найдёт eval, который проверяет порядок «сначала qmd», он называет его в «Итог».

## Test-ы

- `bash harness/hooks/tests/rules-hooks.test.sh` — exit 0 (раздел Phase 0 и упоминание skill-а `worfy:qmd` на месте).
- Test-ы плагина, которые читают тексты skill-ов и правил (`harness/bin/tests/`, `harness/hooks/tests/`), — exit 0.

## Готово, когда

- [ ] Skill `worfy:qmd` называет правило по модели: Opus и Sonnet — сначала `grep`, `qmd` — когда `grep` ничего не
      нашёл или вопрос «был ли урок / почему так решили»; Haiku — сначала `qmd`; с цифрами замера и пересмотром.
- [ ] Phase 0 правил Orchestrator-а согласована с правилом; решение — в «Итог».
- [ ] `scout.md`, `implementer.md`, `ship-ticket`, `epic-wave` не противоречат правилу.
- [ ] «Итог»: предложение Ticket-а на повторный замер через месяц на настоящих вопросах.
- [ ] `bash harness/hooks/tests/rules-hooks.test.sh` — exit 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
