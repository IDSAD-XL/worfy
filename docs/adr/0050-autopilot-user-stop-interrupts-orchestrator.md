# 0050 — Stop в Autopilot прерывает Session Orchestrator-а и его Background task-и
Дата: 2026-10-07. Статус: принят.

**Контекст.** 2026-10-07 владелец попросил поставить работу на паузу, нажал «Stop autopilot» и
увидел, что работа идёт дальше (журнал `2026-10-07T17-46-49-381Z-d32be6.jsonl`, Ticket
`worfy-week/17`). Так и задумано в ADR-0029, пункты 5–6: Stop останавливает прогон, но Orchestrator
остаётся Session без человека в `bypassPermissions`, пока не кончатся его ход и Background task-и
(implementer-ы, запущенные `/epic-wave` в фоне). Конец Background task-а присылает
task-notification, тот начинает новый ход в той же Session, и `/epic-wave` идёт дальше, вплоть до
merge. Человек, который нажал Stop, ждёт обратного: что агенты остановились.

Две посылки ADR-0029 на деле не выполнялись:

- «Background task-и переживают остановку». Ручная кнопка Interrupt (`agent.interrupt`) уже сейчас
  убивает их: без объявления `perTaskStopAffordance` (worfy его не задаёт) interrupt во время хода
  убивает Background task-и самим CLI (`@anthropic-ai/claude-agent-sdk`, `sdk.d.ts:1801-1802`).
- «Человек, которому нужно убить задачи, закрывает приложение» (пункт 6). Владелец так и сделал:
  убил процесс руками через 95 s после Stop.

Этот ADR заменяет пункты 5 и 6 ADR-0029 и отвергнутый там вариант «Stop сразу вызывает `stopTask`
каждой задачи» — только для причины `user-stop`. Остальное в ADR-0029 остаётся в силе.

**Решение.**

1. **Stop пользователя (`user-stop`) прерывает, а не ждёт.** Порядок в main
   (`src/main/autopilot/run.ts`, `end()`):
   - `run-stopped` с причиной `user-stop`, живыми задачами (`tasks`) и Ticket-ами прерванной Wave
     (`tickets`);
   - Wave, которая ещё ждёт в очереди Session, убирается из очереди, как и раньше;
   - `Session.halt()` (`src/main/agent/session.ts`): очередь на паузе, открытые permission-запросы
     получают отказ, идущий ход прерывается `interrupt()` и ожидается до `result`, ошибки или
     закрытия, но не дольше `HALT_TURN_MS` — 15 s;
   - `tasks-killed` с причиной `user-stop` и задачами, жившими на момент Stop или начатыми
     прерванным ходом, — если такие были;
   - `Orchestrators.giveBackNow()` (`src/main/agent/orchestrator.ts`): Orchestrator сразу
     перезапускается обычной Session с тем же `resume`. Закрытие старого процесса уносит всё, что
     пережило interrupt: задачи и ход, который не кончился за 15 s;
   - `orchestrator-returned`, keep-awake отпускается, `autopilot.stop` отвечает.

   `stopTask` не нужен: interrupt во время хода убивает задачи сам, а закрытие процесса — все
   остальные. Поднятый с `--resume` процесс только допишет в историю уведомления о брошенных
   задачах; ход они не начинают (журнал `…-d32be6`, 18:07:27).
2. **Остальные причины ждут задачи**, как требует ADR-0029: `background-stalled`,
   `wave-unfinished`, `limits-timeout`, `interrupted` и другие оставляют Orchestrator без человека
   до конца хода и задач. `app-quit` по-прежнему закрывает всё вместе с приложением.
3. **Сообщения человека после Stop ждут.** После `halt()` Session ничего не отправляет в свой
   процесс: сообщение в очереди и сообщение, пришедшее во время Stop, лежат на паузе.
   `relaunch` передаёт очередь новой Session как есть, и сообщения уходят только по «Send queued».
   Раньше после возврата Orchestrator-а они уходили сами.
4. **Продолжение с прерванного Ticket-а.** Implementer, убитый Stop-ом, оставляет свой Ticket в
   `work`, а ready Wave такие Ticket-ы пропускает. Поэтому `AutopilotState.resumable` — Ticket-ы
   прерванной Wave последнего `user-stop` этого Epic-а. Новый прогон того же Epic-а берёт из них
   те, что всё ещё в `work`, в свою первую Wave вместе с ready-набором: в кнопке renderer-а, в
   проверке main (`runWaveState`) и в событии `start` cycle-а. Любой другой Ticket в `work`
   прогон не берёт: его может вести человек руками. `/epic-wave` такую Wave уже умеет
   возобновлять (в транскрипте 2026-10-07 он поднял implementer-а через SendMessage).
5. **UI.** Title кнопки — «Stop Autopilot over <epic>: interrupts the Orchestrator and its
   background tasks; worktrees stay». Stop длится до `HALT_TURN_MS`; пока `autopilot.stop` не
   ответил, кнопка «Stopping…» и не нажимается.

**Последствия.**

- Stop бросает работу implementer-ов на полушаге: worktree и ветки остаются, но шаг (например,
  merge) может остаться недоделанным. Об этом и просил владелец; ADR-0029 запрещал ровно это.
- Implementer, убитый посреди e2e, не снимет замок `/tmp/worfy-e2e.lock`: trap на EXIT не
  срабатывает при SIGKILL. Замок снимет следующий запуск, когда тот старше 30 минут.
- `resumable` живёт в памяти main: после перезапуска приложения он пуст, и Ticket-ы прерванной
  Wave снова приходится продолжать руками («No ready wave»), как до этого ADR.
- Прогон в состоянии «stopping» до 15 s остаётся running: второй Stop ждёт первый, `app-quit`
  в это время ждёт его не дольше обычных 3 s.

## Considered Options

- **Stop = halt + немедленный возврат Orchestrator-а, только для `user-stop`** (выбрано). Interrupt
  и закрытие процесса уже убивают задачи; нужно только не ждать их.
- **Stop вызывает `stopTask` каждой задачи, потом ждёт конца хода.** Отвергнуто: worfy не
  объявляет `perTaskStopAffordance`, без него interrupt убивает задачи сам; `stopTask` добавил бы
  ход по каждой задаче и правку fake-агента без выигрыша.
- **Stop как в ADR-0029, плюс отдельная кнопка «Kill tasks».** Отвергнуто: владелец ждёт этого
  от Stop; вторая кнопка — ещё одно действие человека, а первая продолжает вести себя неожиданно.
- **Прерывать задачи при любой причине остановки.** Отвергнуто: `background-stalled`,
  `wave-unfinished` и `limits-timeout` — решения cycle-а, а не человека; убивать по ним работу
  implementer-ов ADR-0029 запрещает по-прежнему.
- **Возобновлять любой Ticket в `work`.** Отвергнуто: Ticket в `work` может вести человек руками,
  и Autopilot взял бы его без спроса.
- **Хранить `resumable` в журнале и читать при старте приложения.** Отложено: нужен разбор
  журналов при каждом `autopilot.state`; в этом Ticket-е — только память main.
