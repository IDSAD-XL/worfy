# 13 — Принятые Epic-и: статус spec-а в `epic-status` и список для «Run all accepted»

Type: task
Status: claimed 2026-11-06T09:43Z
Blocked by: —
Source: [spec.md](../spec.md), «Как работает» → «Очередь Epic-ов», «Принятые Epic-и»; «Решения владельца», 16; [03](03-очередь-epic-ов.md), Q1; ADR-0002 (worfy читает workflow через инструменты Harness-а)

## Что происходит

- `epic-status --json` отдаёт о Epic-е только `epic`, `hasSpec`, `hasMap` (`harness/bin/epic-status:352-355`; схема
  worfy — `epicStatusEpicSchema`, `src/shared/workflow/types.ts:12-16`).
- Строки `Status:` spec-ов были разные: «принят владельцем 2026-11-04 …», «утверждён владельцем 2026-10-30», «по решению
  владельца 2026-10-19», «по решениям владельца 2026-10-07» (worfy-windows, -harness, -link, -terminal-ai,
  -terminal-ssh, -ui), «решения владельца 2026-10-31 (…) приняты» (worfy-update), «draft», «ждёт приёмки владельцем»,
  «готов к работе после …». 2026-11-06 все принятые spec-и `main` приведены к канонической форме «принят владельцем
  YYYY-MM-DD»; старые формы остаются в истории git, в ветках и в Project-ах других людей.

## Что делаем

1. **Harness `epic-status --json`**: у Epic-а со spec-ом — `specStatus` (строка `Status:` первого абзаца spec-а, без
   переносов, ≤ 300 символов) и `acceptedAt` (`YYYY-MM-DD` — первая дата в строке, если строка начинается с «принят
   владельцем», «утверждён владельцем», «по решению владельца», «по решениям владельца» или с «решения владельца» и
   содержит «приняты»; иначе `null`). Каноническая форма — «принят владельцем YYYY-MM-DD» (её пишут новые spec-и);
   старые формы читаются и дальше как принятые — подтверждено владельцем 2026-11-06. Слова — в
   `harness/lib/input-words.json` рядом с другими словами разбора (ADR-0074: Harness нейтрален по языку). Текстовый вывод не меняется.
2. **worfy**: `epicStatusEpicSchema` — `specStatus`, `acceptedAt` (оба `optional`, старый Harness их не шлёт);
   `src/shared/workflow/accepted-epics.ts` — `acceptedEpics(model)`: Epic-и с `acceptedAt` и хотя бы одним готовым
   Ticket-ом (`readyWave(...).ready`), по `acceptedAt`, при равенстве — по имени.

## Готово, когда

- [ ] `harness/bin/tests/epic-status.test.sh`: fixture-ы spec-ов со всеми формами строки — «принят владельцем»,
      «утверждён владельцем», «по решению владельца», «по решениям владельца», «решения владельца … приняты» —
      `acceptedAt` верный; «draft» и «ждёт приёмки владельцем» — `null`; spec без `Status:` — оба `null`; текстовый
      вывод не изменился. На `.scratch` worfy каждый spec со `Status: принят владельцем YYYY-MM-DD` получает эту дату.
- [ ] Unit test `acceptedEpics`: закрытый Epic (все `done`) не входит; Epic без готовых Ticket-ов не входит; порядок по
      дате.
- [ ] PR ждёт Windows (скрипт Harness-а, ADR-0056); `ci-ok` зелёный.

## Тесты

- Shell test `harness/bin/tests/epic-status.test.sh`, unit `test/unit/accepted-epics.test.ts` (новый).
- Сначала падающий: `--json` без `acceptedAt`.

## Где в коде

- `harness/bin/epic-status`, `harness/lib/input-words.json`, `harness/bin/tests/epic-status.test.sh`
- `src/shared/workflow/types.ts`
- `src/shared/workflow/accepted-epics.ts`, `test/unit/accepted-epics.test.ts` (новые)

Только читать: `src/shared/workflow/waves.ts`, `harness/bin/TICKETS.md`.
