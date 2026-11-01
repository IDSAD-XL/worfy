# 0091 — Запуск Autopilot из чата: тот же Run, что кнопка; Run по названным Ticket-ам и `tickets-done`
Дата: 2026-11-01. Статус: принят. Epic `worfy-flight-recorder`, Ticket 21; spec — `.scratch/worfy-flight-recorder/spec.md`
(«Запуск Autopilot из чата»), решение 09 (Q1–Q7) и решение 02.

**Контекст.** Autopilot (ADR-0024) запускается только кнопкой на рамке Epic-а: `AutopilotAction.tsx` → канал
`autopilot.start` → `Autopilot.start(projectId, epic)` (`src/main/autopilot/run.ts`). Run всегда ведёт весь Epic. Команда
`/worfy:epic-wave …`, набранная в чате Session внутри worfy, и просьба словами («запусти на автопилоте», «работай
автономно») уходят агенту как текст: он ведёт Wave сам, без Run, без Journal, без строки статуса и без поведения
Autopilot (keep-awake, ожидание Limits, бюджет, очередь gate). Владелец решил (решение 09), что запуск из чата — такой же
запуск, как кнопкой. Команда при этом часто называет не весь Epic, а несколько Ticket-ов (`tickets 05, 06 of epic X`).

**Решение.**

1. **Тот же Run.** Команда в чате (Ticket 22) и инструмент Orchestrator-а `autopilot_start` (Ticket 23) запускают тот же
   `Autopilot.start`, что кнопка: тот же Run, Journal, строка статуса и всё поведение. Отдельного «Run из чата» нет.
2. **Run по названным Ticket-ам.** `Autopilot.start(projectId, epic, { tickets })` и необязательное поле `tickets` канала
   `autopilot.start` (целые положительные номера, хотя бы один). Cycle (`src/shared/autopilot/cycle.ts`) держит список в
   состоянии (`named`) и считает готовыми, пропущенными (`skipped`) и подхваченными после Force stop (`resume`) только
   Ticket-ы списка; остальные Ticket-ы Epic-а по-прежнему блокируют названные и держат свои файлы, пока в работе.
   **Прерванная Wave и список.** Если последний Force stop этого Epic-а прервал Wave (`resumable`), Run по списку берёт
   из неё только Ticket-ы списка. Остальные он не трогает и оставляет в `resumable`, когда останавливается, с любой
   причиной (`Run.carried`, `run.ts`): их подхватит следующий Run всего Epic-а. После Force stop самого Run-а по
   списку в `resumable` — и его Wave, и эти Ticket-ы. Без этого они остались бы `work` навсегда: не `open`, не
   `resumable`, и держали бы свои файлы.
   Тот же список получает «Run wave» Autopilot-а (`ActionLauncher.autopilotWave` → `runWaveState` → `readyWave(…, named)`),
   так что текст Wave называет только Ticket-ы из списка; `{wave}` считается по плану всего Epic-а. Без списка Run ведёт
   весь Epic, как кнопка; кнопка списка не передаёт.
3. **`tickets-done`.** Когда все названные Ticket-ы `done` в checkout-е (не только в своей ветке worktree), Run
   останавливается с новой причиной `tickets-done` — обычный конец, как `no-ready-wave` у Run по Epic-у. Это проверяется
   и на старте, и после каждой Wave. Заблокированный названный Ticket останавливает Run как раньше (`blocked-tickets`);
   заблокированный Ticket вне списка Run не останавливает. Правило `no-progress` (та же Wave готова снова) не меняется.
   Ход «Process gate queue» перед остановкой (ADR-0069) остаётся только у `no-ready-wave` и `blocked-tickets`.
4. **Общая точка входа** — `src/main/autopilot/chat-start.ts`, `ChatStarts.startFromChat`; Ticket-ы 22 и 23 только зовут
   её (`sharedChatStarts()` в `src/main/ipc/autopilot.ts`):
   - Epic должен быть в Project-е, названные Ticket-ы — в Epic-е (`startRefusal` в `run.ts`, его же зовёт
     `Autopilot.start`); иначе отказ, который их называет;
   - пока в Project-е идёт или стартует Run — отказ «Autopilot is already running Epic X. Stop it first.»; в Journal
     ничего не пишется, до Run дело не дошло;
   - иначе — `Autopilot.start` с теми же аргументами, что у кнопки (`override: false`), плюс список и кто начал;
   - если спросил Orchestrator этого Project-а из своего хода, Run стартует, когда его Session станет idle
     (`Autopilot.start` отказывает Orchestrator-у в ходе); ответ — «Autopilot starts after this turn». Пока такой старт
     ждёт, следующий запрос получает отказ «Autopilot is about to start Epic X after the Orchestrator's turn.» (остановить
     ещё нечего). Session закрылась или упала раньше — Run не стартует, и ничего не сообщается.
   - **Перед обещанием «после хода»** спрашиваются все отказы, известные уже сейчас: живые background tasks и
     сообщения в очереди Orchestrator-а (`orchestratorRefusal`, те же тексты, что у `setUnattended`) и
     `Autopilot.startCheck` — Run в Project-е, свой репозиторий worfy в development-сборке, шаблон «Run wave», workflow,
     Epic и Ticket-ы, Run того же Epic-а и origin на Linked machine (у старта из чата нет «Start anyway»). Любой из них —
     отказ сразу, ничего не ждёт.
   - **Отказ после хода** (например, человек успел поставить сообщение в очередь, или нажал кнопку Autopilot)
     ответом инструмента уже не вернуть: он показывается на Session Orchestrator-а как notice вида `notification`
     («Autopilot did not start Epic X: <причина>», `Session.notice`, событие `notice` уже есть в протоколе Session) и
     пишется в log main process. В Journal он не попадает: Run не начался.
5. **Кто начал Run** (`button`, `command`, `tool`) передаётся в `Autopilot.start` и хранится в Run. В Journal
   (`run-started.by`, `run-started.tickets`) его пишет Ticket 11; этот ADR формат Journal не меняет.
6. **Без Run остаются** (решение 09, Q7): «Run wave» с Canvas и из Command palette, и Wave, начатая в Claude в терминале
   вне worfy. worfy их не видит как запуск и Journal для них не ведёт.

**Цена.** Отказ, который приходит только после конца хода, Orchestrator не видит: notice показывается человеку в окне
Session, а агенту не уходит. Ticket-ы, отложенные Run-ом по списку в `resumable`, переживают только до перезапуска
приложения, как и `resumable` после Force stop.

## Considered Options

- **Фильтровать Wave только в cycle.** Отвергнуто: текст и Ticket-ы Wave собирает `runWaveState` в launcher-е, а не
  cycle; без списка там Wave назвала бы и Ticket-ы вне списка.
- **Убирать Ticket-ы вне списка из чтения workflow до `readyWave`.** Отвергнуто: блокер вне списка тогда стал бы
  «missing-blocker», а Ticket вне списка в работе перестал бы держать свои файлы, и Wave взяла бы Ticket с общим файлом.
- **Отказывать в старте по списку, пока есть прерванная Wave с Ticket-ами вне списка.** Отвергнуто: заставляет
  человека сначала запускать весь Epic, хотя он назвал другие Ticket-ы; перенос остатка в `resumable` ничего не теряет.
- **Только запись (worfy замечает Wave из чата и ведёт для неё Journal, но без поведения Autopilot).** Отвергнуто
  владельцем (решение 09, вариант «а»).
- **Отдельная причина остановки не нужна, хватит `no-ready-wave`.** Отвергнуто: `no-ready-wave` значит «в Epic-е нечего
  брать», а Run по списку кончается, когда в Epic-е ещё есть готовые Ticket-ы; Journal и строка статуса должны это
  различать.
