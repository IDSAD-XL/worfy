# 13 — Принятые Epic-и: статус spec-а в `epic-status` и список для «Run all accepted»

Type: task
Status: open
Blocked by:
Source: [spec.md](../spec.md), «Как работает» → «Очередь Epic-ов», «Принятые Epic-и»; «Решения владельца», 16; [03](03-очередь-epic-ов.md), Q1; ADR-0002 (worfy читает workflow через инструменты Harness-а)

## Что происходит

- `epic-status --json` отдаёт о Epic-е только `epic`, `hasSpec`, `hasMap` (`harness/bin/epic-status:352-355`; схема
  worfy — `epicStatusEpicSchema`, `src/shared/workflow/types.ts:12-16`).
- Строки `Status:` spec-ов разные: «принят владельцем 2026-11-04 …», «утверждён владельцем 2026-10-30», «по решению
  владельца 2026-10-07», «draft», «ждёт приёмки владельцем», «готов к работе после …».

## Что делаем

1. **Harness `epic-status --json`**: у Epic-а со spec-ом — `specStatus` (строка `Status:` первого абзаца spec-а, без
   переносов, ≤ 300 символов) и `acceptedAt` (`YYYY-MM-DD` — первая дата в строке, если строка начинается с «принят
   владельцем», «утверждён владельцем» или «по решению владельца»; иначе `null`). Слова — в `harness/lib/input-words.json`
   рядом с другими словами разбора (ADR-0074: Harness нейтрален по языку). Текстовый вывод не меняется.
2. **worfy**: `epicStatusEpicSchema` — `specStatus`, `acceptedAt` (оба `optional`, старый Harness их не шлёт);
   `src/shared/workflow/accepted-epics.ts` — `acceptedEpics(model)`: Epic-и с `acceptedAt` и хотя бы одним готовым
   Ticket-ом (`readyWave(...).ready`), по `acceptedAt`, при равенстве — по имени.

## Готово, когда

- [ ] `harness/bin/tests/epic-status.test.sh`: fixture-ы spec-ов со всеми формами строки — `acceptedAt` верный; spec
      без `Status:` — оба `null`; текстовый вывод не изменился.
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
