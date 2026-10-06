# 08 — Зависшие running Subagent-ы без task-notification

Type: task
Status: blocked — blocked by 05
Blocked by: 05
Source: [spec.md](../spec.md), тема B, риск 9; Ticket 15 worfy-mvp (дерево Subagent-ов)

## Что делаем

На Auction 13 из 109 Subagent-ов навсегда остаются в `running`, хотя давно не работают. У них нет
task-notification — сообщения Claude Code о том, что фоновая задача закончилась.

**Как сейчас считается статус** — `statusOf()` в `src/shared/transcript/subagents.ts:371-378`:

1. есть task-notification → `done` или `error`;
2. `result.isError` или `meta.stoppedByUser` → `error`;
3. есть `result`, и Subagent не фоновый → `done`;
4. `file.ended` → `done`;
5. иначе — `running`.

`file.ended` — это последняя запись assistant со `stop_reason: end_turn` (`:232`). Любая запись
user снимает этот признак (`:235`). У фонового Subagent-а `result.launched` его не завершает
(`:375`).

**Вывод из кода, на данных не проверен.** Фоновый Subagent навсегда остаётся `running`, если у него
нет task-notification, а последний `stop_reason` — не `end_turn`. Так бывает при `tool_use`,
`max_tokens`, оборванном процессе или закрытой Session.

**Первый шаг — разбор на настоящих данных Auction, только чтение.** Для каждого зависшего записать:

- последнюю запись транскрипта;
- `meta.json`;
- есть ли task-notification;
- жива ли Session.

Перепроверить само число «13 из 109». Таблица причин идёт в «Итог», без содержимого промптов.

**Правило статуса — по итогу разбора.** Решает ADR (номер с 0022): считать ли `running` законченным,
если Session не live или файл не менялся N минут. Новый статус (например `stale`) меняет тип
`SubagentStatus` (`:92`). Тогда меняются и все его потребители: дерево и Node-ы Subagent-ов на
Canvas (`src/renderer/canvas/sources/subagents.ts`). Ложный `done` у живого длинного Subagent-а хуже
зависшего `running`, и правило не должно его давать.

**Фикстуры** — по одной на каждую найденную причину.

## Готово, когда

- [ ] В «Итог» — таблица причин для зависших Subagent-ов Auction.
- [ ] ADR о статусе принят.
- [ ] Фикстура каждой причины даёт статус по ADR. Subagent, который реально работает (файл растёт, Session live), остаётся `running`.
- [ ] (вручную) На Auction после изменения в `running` остались только реально работающие Subagent-ы. Число — в «Итог».
- [ ] `~/.claude` только читается: дерево временного `WORFY_CLAUDE_HOME` после test-а не изменилось.

## Тесты

- `test/unit/subagents.test.ts` — новые случаи `statusOf`.
- `test/contract/claude-home-subagents.test.ts` — фикстуры: фоновый без task-notification; последний `stop_reason` не `end_turn`; Session уже не live.
- Сначала падающий test: фоновый Subagent без task-notification в закрытой Session имеет статус `running`.

## Где в коде

- `src/shared/transcript/subagents.ts`
- `src/main/claude-home/subagents.ts`
- `src/renderer/canvas/sources/subagents.ts`
- `test/unit/subagents.test.ts`
- `test/contract/claude-home-subagents.test.ts`
- `test/fixtures/claude-home/`
