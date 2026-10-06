# 0030 — Task-notification из очереди Claude Code кончает Subagent-а
Дата: 2026-10-06. Статус: принят.

**Контекст.** Дерево Subagent-ов (Ticket 15 Epic-а worfy-mvp) считает статус в `statusOf()`
(`src/shared/transcript/subagents.ts`): task-notification → `done` или `error`; ошибка вызова или
`meta.stoppedByUser` → `error`; результат синхронного вызова → `done`; последняя запись файла
Subagent-а с `stop_reason: end_turn` → `done`; иначе `running`. На Auction часть Subagent-ов
навсегда оставалась `running`. Ticket 08 Epic-а worfy-daily предполагал, что у них нет
task-notification — сообщения Claude Code о конце фоновой задачи.

Разбор всех транскриптов Auction (папки `~/.claude/projects/*Auction*`, 110 Session-ов с папкой
`subagents/`, 3179 Subagent-ов; только чтение) показал другое:

- `running` — 311 из 3179. Число «13 из 109» из спецификации Epic-а — одна папка проекта,
  worktree `ui-motion-plan`; на ней оно воспроизводится точно.
- У 310 из 311 task-notification есть. Claude Code 2.1.2xx пишет уведомление, пришедшее, пока
  Session занята, в очередь: запись `queue-operation` с `operation: enqueue`, а после доставки —
  запись `attachment` типа `queued_command` (`commandMode: task-notification`). Записи `user` с
  этим текстом часто нет вовсе. worfy читал task-notification только из записи `user`.
- У одного Subagent-а уведомления нет нигде; его статус решает ADR-0031 (закрытая Session).
- Признак `end_turn` в 2.1.260 почти не срабатывает: последняя запись ответа пишется с
  `stop_reason: null`.

**Решение.** Запись `queue-operation` с `operation: enqueue` и запись `attachment` типа
`queued_command`, текст которых начинается с `<task-notification>`, читаются как запись `user` с
этим текстом и дают тот же сигнал `finished`. `queue-operation` с `remove` и другие команды очереди
не читаются. Это касается и транскрипта Session, и транскриптов Subagent-ов (уведомления о
вложенных Subagent-ах). Тип `SubagentStatus` не меняется.

Если одно уведомление записано в нескольких формах (`enqueue`, `attachment`, `user`), берётся
последняя копия, как и раньше для нескольких уведомлений одного Subagent-а: так Subagent,
продолженный через SendMessage, получает статус своего последнего конца.

**Последствия.** На Auction по одному этому правилу из 311 зависших 294 стали `done` и 16 —
`error` (статус в уведомлении `failed`, `killed` или `stopped`). Ещё один Subagent, раньше `done`,
стал `error`: он кончился синхронным вызовом (`completed`), потом его продолжили через
SendMessage, и второй прогон кончился уведомлением из очереди со статусом `failed`, которое раньше
не читалось. Просмотр транскрипта Session (`parse.ts`) уведомлений из очереди по-прежнему не
показывает.

## Considered Options

- **Читать очередь в `parse.ts` для всех потребителей.** Отложен: тогда в просмотре транскрипта
  одно уведомление пришло бы до трёх раз (`enqueue`, `attachment`, `user`), а это отдельная правка
  просмотра. Сейчас очередь читает только дерево Subagent-ов.
- **Читать только `attachment` `queued_command`.** Отвергнут: у 1791 уведомления на Auction есть
  только `queue-operation` (`enqueue` и `remove`), без `attachment` и без записи `user`.
- **Читать и `remove`.** Отвергнут: это та же задача, вынутая из очереди, нового о Subagent-е она
  не говорит, а как последняя копия затёрла бы итог `enqueue`, если её текст неполон.
