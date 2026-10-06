# 08 — Зависшие running Subagent-ы без task-notification

Type: task
Status: claimed — 2026-10-06
Blocked by: 05, 29
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

- [x] В «Итог» — таблица причин для зависших Subagent-ов Auction.
- [x] ADR о статусе принят.
- [x] Фикстура каждой причины даёт статус по ADR. Subagent, который реально работает (файл растёт, Session live), остаётся `running`.
- [ ] (вручную) На Auction после изменения в `running` остались только реально работающие Subagent-ы. Число — в «Итог».
- [x] `~/.claude` только читается: дерево временного `WORFY_CLAUDE_HOME` после test-а не изменилось.

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

## Итог

Решение — [ADR-0030](../../../docs/adr/0030-subagent-status-without-task-notification.md).

### Разбор на данных Auction

Снято 2026-10-06, только чтение: все папки `~/.claude/projects/*Auction*`, 110 Session-ов с папкой
`subagents/`, 3179 Subagent-ов. Дерево строилось кодом worfy с `origin/main` 9fcdaff
(`SubagentReader` + `buildSubagentTree`), скриптом вне репозитория. Живых Session-ов Auction в
момент замера не было.

- `running` — 311 из 3179. «13 из 109» из спецификации — одна папка, worktree `ui-motion-plan`
  (109 Subagent-ов, 13 `running`); на ней число воспроизводится точно.
- Посылка тикета («нет task-notification») верна для одного Subagent-а из 311.

| Причина | Последняя запись транскрипта Subagent-а | `meta.json` | task-notification | Session жива | Сколько |
|---|---|---|---|---|---|
| Уведомление только в очереди: `queue-operation` `enqueue` (+`remove`) и/или `attachment` `queued_command`; записи `user` нет — worfy его не читал | ответ с `stop_reason: null` (2.1.260 пишет так и последний ответ), реже `stop_sequence` или `user`; у части файла Subagent-а нет | обычно `agentType`, `description`, `toolUseId`, `spawnDepth`; `requestShape` нет | есть, в очереди | нет | 310 |
| Session закрылась, пока Subagent работал | ответ с вызовом `WebFetch`, `stop_reason: tool_use` | `agentType`, `description`, `toolUseId`, `spawnDepth` | нет нигде | нет | 1 |

Как записано уведомление в транскриптах Auction (по task-id, все фоновые задачи, не только
Subagent-ы): только `queue-operation` `enqueue`+`remove` — 1791; `enqueue` + запись `user` — 2034;
только `attachment` — 894; `attachment` + `enqueue` + `remove` — 849; только `user` — 382; прочие
сочетания — 143. Статусы в уведомлениях из очереди: `completed` 4859, `failed` 118, `killed` 28,
`stopped` 6.

### После правки

Тем же скриптом над кодом ветки: `running` — 0, `done` — 3127 (было 2834), `error` — 52 (было 34).
Из 311 зависших: 293 → `done` и 17 → `error` по уведомлению из очереди, 1 → `error` по закрытой
Session. Папка `ui-motion-plan`: 109 `done`, 0 `running`.

Пункт «(вручную)» не отмечен: число получено скриптом над тем же кодом, в самом приложении на
Canvas не проверено (GUI-проверки в этой волне — не у исполнителя).

### Фикстуры

`test/fixtures/claude-home/projects/-Users-test-projects-stale/` — Session 9999 (2.1.260): Subagent
`a6…260` кончился уведомлением только из очереди; Subagent `a7…260` без уведомления, последняя
запись — `tool_use`, Session закрыта. Живая Session (запись в `sessions/` и идущий процесс)
моделируется в test-е на копии: `a7…260` остаётся `running` и при растущем файле.
