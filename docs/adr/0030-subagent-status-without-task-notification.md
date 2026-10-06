# 0030 — Статус Subagent-а: task-notification из очереди и закрытая Session
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
- У одного Subagent-а уведомления нет нигде: последняя запись — вызов WebFetch
  (`stop_reason: tool_use`), Session давно закрыта (записи в `~/.claude/sessions/` нет).
- Признак `end_turn` в 2.1.260 не срабатывает: последняя запись ответа пишется с
  `stop_reason: null`. На него нельзя опереться и для «тихого» конца.

Фоновый Subagent живёт в процессе Claude Code своей Session: процесс кончился — кончились и его
Subagent-ы (ADR-0029, контекст: закрытая Session Autopilot унесла четыре background task-а).

**Решение.**

1. **Task-notification из очереди — такой же конец, как из записи `user`.** Запись
   `queue-operation` с `operation: enqueue` и запись `attachment` типа `queued_command`, текст
   которых начинается с `<task-notification>`, читаются как запись `user` с этим текстом и дают тот
   же сигнал `finished`. `queue-operation` с `remove` и другие команды очереди не читаются. Это
   касается и транскрипта Session, и транскриптов Subagent-ов (уведомления о вложенных).
2. **Закрытая Session кончает всех, кто не кончился.** main (`SubagentReader`) перед чтением
   файлов Session спрашивает `sessions/<pid>.json` той же домашней папки Claude, как реестр
   Session-ов (`src/main/claude-home/registry.ts`, Ticket 13 worfy-mvp): Session жива, если есть запись с её
   `sessionId` и процесс `pid` с этим `procStart` идёт. Если нет — к сигналам Session добавляется
   `session-closed`, и каждый её Subagent без конца получает статус `error` — как остановленный
   пользователем. Время работы такого Subagent-а кончается его последней записью.
3. **Пока Session жива, Subagent без конца — `running`**, сколько бы его файл ни стоял. Ложный
   `done` или `error` у живого длинного Subagent-а хуже зависшего `running`.
4. **Не знаем — не закрываем.** Нет папки `sessions/`, транскрипт не под `projects/`, запись
   реестра не читается (её могут переписывать в этот момент) — `session-closed` не ставится.
5. **Порядок чтения.** Живость спрашивается до чтения файлов: если Session уже закрыта, в файлах
   уже лежит всё, что она написала, и Subagent, кончившийся перед самым выходом процесса, читается
   кончившимся, а не оборванным.
6. Тип `SubagentStatus` не меняется: `running | done | error`.

После правки на Auction: `running` — 0 (живых Session-ов Auction в момент замера не было), `done` —
3127 (было 2834), `error` — 52 (было 34). Из 311 зависших 293 стали `done` и 17 — `error` по
уведомлению из очереди (статус `failed`, `killed` или `stopped`), 1 — `error` по закрытой Session.

**Последствия.**

- Subagent, оборванный закрытием Session, показывается `error` с последним текстом из его файла,
  а не висит `running` с растущим временем. Опрос его Session в renderer прекращается.
- main при каждом чтении Subagent-ов Session читает `sessions/*.json` и для записи этой Session
  проверяет процесс (`kill -0`, `ps -o lstart=`).
- Не проверено: Session, сменившая `sessionId` внутри одного процесса (например `/clear`), —
  запись реестра уже называет новый id, и Subagent-ы старого транскрипта, если они живут дальше,
  будут показаны `error`.

## Considered Options

- **Новый статус `stale` («не отвечает»).** Отвергнут: после чтения уведомлений из очереди он
  нужен одному Subagent-у из 3179. Он меняет `SubagentStatus` и все его потребители — Node и строку
  rail-а (там исчерпывающие таблицы статусов), опрос, свёртку `done` на Canvas, — а по смыслу это
  тот же конец без результата, что и `stoppedByUser`, который уже `error`.
- **`running` → `done`, если файл не менялся N минут.** Отвергнут: живой Subagent часто молчит
  долго (`gh run watch` с timeout 600000, длинный test-раннер); правило дало бы ложный `done`.
- **`running` → `error` по тишине файла и закрытой Session вместе.** Отвергнут как лишний: закрытой
  Session достаточно — её Subagent-ы не могут работать, тишина ничего не добавляет.
- **Читать очередь в `parse.ts` для всех потребителей.** Отложен: тогда в просмотре транскрипта
  одно уведомление пришло бы до трёх раз (`enqueue`, `attachment`, `user`), а это отдельная правка
  просмотра. Сейчас очередь читает только дерево Subagent-ов.
