# 08 — Зависшие running Subagent-ы без task-notification

Type: task
Status: done 2026-10-06
PR: #45
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
- [x] (вручную) На Auction после изменения в `running` остались только реально работающие Subagent-ы. Число — в «Итог». (Проверено 2026-10-07: `running` 0 при 0 работающих — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).)
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

Решения — [ADR-0030](../../../docs/adr/0030-subagent-status-without-task-notification.md)
(task-notification из очереди) и [ADR-0031](../../../docs/adr/0031-closed-session-ends-its-subagents.md)
(закрытая Session кончает своих Subagent-ов).

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
Сравнение по каждому Subagent-у (старый код против нового):

| Переход | Почему | Сколько |
|---|---|---|
| `running` → `done` | уведомление из очереди со статусом `completed` (у 76 из них узел дерева теперь связан с вызовом через `<tool-use-id>` уведомления) | 294 |
| `running` → `error` | уведомление из очереди со статусом `failed`, `killed` или `stopped` | 16 |
| `running` → `error` | уведомления нет, Session закрыта (ADR-0031) | 1 |
| `done` → `error` | Subagent `a8e8123df57d3153c` (Auction-sale-loop): кончился синхронным вызовом (`completed`), потом продолжен через SendMessage, второй прогон кончился уведомлением из очереди со статусом `failed`; раньше оно не читалось | 1 |
| без изменений | (у одного `done` узел тоже связан с вызовом заново) | 2867 (2833 `done`, 34 `error`) |

Папка `ui-motion-plan`: 109 `done`, 0 `running`.

Пункт «(вручную)» до 2026-10-07 не был отмечен: число получено скриптом над тем же кодом, в самом приложении на
Canvas не проверено (GUI-проверки в этой волне — не у исполнителя). На Canvas проверено 2026-10-07 —
подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).

### Фикстуры

`test/fixtures/claude-home/projects/-Users-test-projects-stale/` — Session 9999 (2.1.260): Subagent
`a6…260` кончился уведомлением только из очереди; Subagent `a7…260` без уведомления, последняя
запись — `tool_use`, Session закрыта. Живая Session (запись в `sessions/` и идущий процесс)
моделируется в test-е на копии: `a7…260` остаётся `running` и при растущем файле.

### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (второй круг ручных проверок).

**Auction на Stable copy — проверка M20.** Stable copy из 6df9791 (pid 2455, CDP 9351). Project Auction
добавлен через `projects.add` в 07:12:04Z. Orchestrator Auction стартовал без хода (pid 64936, Session
c3223b30, транскрипта нет), сообщений ему не отправляли.

- Живая Session Auction в `~/.claude/sessions` одна — этот Orchestrator, idle, без Subagent-ов.
  Значит, реально работающих Subagent-ов 0.
- Чтобы было что считать, History → Show поставил 3 read-only Node-а прошлых Session (Claude Code не
  запускался). d36f39e0 — та Session, где до правки было «13 из 109» в `running`: теперь «109 done».
  0d0f7e4c — «104 done». 99564eee — 16 error («Concurrent subagent limit reached») и 50 done.
- `running` на Canvas — 0 и в store React Flow, и в DOM: совпадает с числом работающих (0).
- Потом все три Node-а сняты кнопкой Remove: в `layout.json` Auction снова 2 Node-а, viewport
  возвращён в (0, 0, 1).
- Замечания [low], вне критериев:
  - History Auction показывает одну Session двумя строками: транскрипт с одним sessionId лежит в двух
    папках `~/.claude/projects` (`ui-motion-plan` и `ui-triage-3-night-wave-7ee36e`). При сборке
    History строки по sessionId не схлопываются (`src/main/claude-home/registry.ts:428-440`), и в
    `HistoryPopover` у двух строк одинаковый React key (`session.sessionId`).
  - Строки History идут по mtime файла транскрипта (`registry.ts:439`), а не по времени последней
    записи. Поэтому даты в списке не монотонны: Sep 28, Oct 4, Aug 27.
  - У read-only Node-а истории подсказка кнопки Remove — «Remove the Node; the Session goes on»
    (`src/renderer/canvas/nodes/SessionNode.tsx:378`), хотя Session давно закончена.
- Вердикт: проверено.
- Снимки (в scratchpad Session Orchestrator-а, в репозиторий не положены): `M20-before.png`,
  `M20-auction-open.png`, `M20-history-popover.png`, `M20-show-d36f39e0.png`, `M20-show-three.png`,
  `M20-after-remove.png`, `M20-final.png`.

### Долги из HANDOFF (2026-10-08)

- [low] Реестр Session-ов при сбое `ps` считает Session неживой: `processAlive`
  (`src/main/claude-home/registry.ts:129`) сводит «не знаю» к `false`. `SubagentReader` после круга
  доработки так уже не делает.
- [low] Просмотр транскрипта не показывает task-notification из очереди Claude Code:
  `src/shared/transcript/parse.ts:75` читает только форму `user`.
- [low] Признак конца Subagent-а по `stop_reason: end_turn` почти не срабатывает в Claude Code 2.1.2xx.
