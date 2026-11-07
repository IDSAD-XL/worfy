# 0100 — Run ведёт очередь Epic-ов
Дата: 2026-11-06. Статус: принят. Epic `worfy-autopilot-queue`, Ticket 14; spec — `.scratch/worfy-autopilot-queue/spec.md`
(«Как работает» → «Очередь Epic-ов», «Открытые вопросы», 3); правило перехода — Ticket 12 (`src/shared/autopilot/epic-queue.ts`), выбор
принятых Epic-ов — Ticket 13 (`src/shared/workflow/accepted-epics.ts`).

**Контекст.** Run (ADR-0024) вёл один Epic: цикл `initialCycle` → Wave-ы → остановка, и `run-stopped`. Когда Epic
кончался ночью, Autopilot стоял до утра, хотя в Project-е были другие Epic-и, принятые владельцем. Человеку
приходилось запускать Run на каждый Epic по одному. Spec Epic-а просит очередь: Run берёт несколько Epic-ов и идёт по
ним сам, пока не кончится работа или не случится настоящая остановка.

**Решение.**
1. **Очередь живёт в одном Run-е.** `AutopilotStartOptions.epics` — от 1 до `MAX_QUEUE_EPICS` (10) Epic-ов, первый —
   тот же, что `epic`; повтор Epic-а в списке сливается в один. Named Ticket-ы (`tickets`) — только при очереди из
   одного Epic-а, иначе отказ при старте. Старый вход `{ epic }` — очередь из одного Epic-а и ведёт себя, как раньше.
   Run держит `queue`, `index` (Epic, на котором он идёт) и `outcomes` (как кончились пройденные Epic-и); у каждого
   Epic-а свой `initialCycle`, Wave-ы снова считаются с 1. Один Run — один id, одна Session Orchestrator-а, один
   Journal и один `run-stopped` на весь Run.
2. **Переход и пропуск — правило Ticket 12.** Цикл Epic-а остановился — Run заново читает workflow и спрашивает
   `epicOutcome(reason, tickets, epic)`. `next` с `done` (всё сделано) или `waits-owner` (оставшиеся Ticket-ы ждут
   только владельца) — `epic-finished` и следующий Epic через `epic-started`. `stop` — остановка всего Run-а.
3. **Стоп всего Run-а.** Stop, Force stop, выход из приложения, `limits-timeout`, `no-progress`, ошибки Session, отказ
   Vendor-а и всё, что `epicOutcome` не считает концом Epic-а, останавливают весь Run; следующие Epic-и не начинаются.
   Не прочитался workflow при переходе — тоже стоп. Очередь кончилась — `run-stopped` с причиной последнего Epic-а.
   Edit-ы, которые ждали конца Wave и не дождались, отбрасываются.
4. **Другая Machine.** При старте `checkElsewhere` проверяет каждый Epic очереди одним вопросом к Linked machines;
   занят хоть один — старт отказан, как для одного Epic-а, а «Start anyway» снимает проверку на весь Run. Без «Start
   anyway» проверка повторяется в начале каждого следующего Epic-а: Epic уже идёт на другой Machine — `epic-finished`
   `elsewhere`, Run берёт следующий.
5. **События журнала.** `run-started.epics` — вся очередь, когда в ней больше одного Epic-а. `epic-started` (`index`,
   `of`) — для каждого Epic-а, кроме первого. `epic-finished` (`outcome`: `done` | `waits-owner` | `elsewhere` |
   `removed`, `tickets` при `waits-owner`) — для каждого пройденного, убранного или пропущенного Epic-а; Epic, на
   котором Run остановился, его не получает. `queue-changed` (`added`, `removed`) — правка очереди; убранный Epic сразу
   после неё получает `epic-finished` `removed` на своей строке. `epic` каждой строки — Epic, о котором она: текущий
   Epic Run-а, а для `elsewhere` и `removed` — пропущенный. Run из одного Epic-а пишет журнал, как раньше.
6. **Правка между Wave-ами.** `Autopilot.editQueue(projectId, { add?, remove? })`, канал `autopilot.queue` (`write`).
   Добавить — в конец, Epic Project-а, которого нет в очереди, в пределах `MAX_QUEUE_EPICS`; к Run-у с named Ticket-ами
   добавить нельзя. Убрать — только не начатый Epic; убрать идущий или пройденный — отказ. После Stop очередь не
   меняется: следующий Epic уже не начнётся, поэтому правка — отказ. Во время Wave правка ждёт её
   конца и применяется сразу после `wave-finished`; пока Run ждёт Orchestrator-а (ADR-0099), budget или окна Start —
   сразу. Добавление, которое ещё ждёт, можно забрать обратно, убрав тот же Epic.
7. **Состояние.** `queue: { epic, status }[]` (`done`, `running`, `next`, `waits-owner`, `elsewhere`) и `index`.
   Прогноз при старте — сумма оставшихся Wave-ов всех Epic-ов очереди; budget проверяется на каждой границе Wave, как
   раньше; Run mode — общий на весь Run.
8. **Какие Epic-и класть в очередь.** «Run all accepted» берёт Epic-и, spec которых принят владельцем, из
   `epic-status --json` (`acceptedAt`, Ticket 13); worfy сам spec не читает (ADR-0002). Run принимает готовый список и
   не выбирает Epic-и сам.

**Последствия.** Wave-ы считаются внутри Epic-а, а не внутри Run-а: Flight Recorder и Run history, которые сводят
Wave-ы по номеру в пределах Run-а, должны учитывать `epic` строки (Ticket 18 этого Epic-а). Отказ при старте из-за
одного занятого Epic-а очереди строже, чем пропуск: человек видит причину сразу, а не утром.

## Considered Options

- **Смешанные Wave-ы: Ticket-ы разных Epic-ов в одной Wave.** Отвергнуто: Wave — шаг одного Epic-а (`epic-wave`), его
  ветки, проверки и порядок Ticket-ов живут внутри Epic-а; смешение ломает и Harness, и правило перехода Ticket 12.
- **Отдельный Run на каждый Epic.** Отвергнуто: каждый новый Run заново перезапускает Session Orchestrator-а и ждёт
  его (ADR-0099), даёт отдельный журнал и отдельный прогноз; человек не видит очередь целиком, а между Run-ами нет
  места для решения «следующий или стоп».
- **Перестановка Epic-ов во время Run-а.** Отвергнуто: добавить в конец и убрать не начатый покрывают нужды владельца;
  перестановка добавляет состояние, которое трудно показать и проверить, и спорит с прогнозом, посчитанным при старте.

## Amendments

- 2026-11-07 — п. 3, «Очередь кончилась — `run-stopped` с причиной последнего Epic-а»: кроме последнего Epic-а, в котором
  остались только Ticket-ы владельца. Он получает `epic-finished` `waits-owner`, как пропущенный, и Run останавливается
  с новой причиной `waits-owner` (`AUTOPILOT_STOP_REASONS`), строка — «stopped: waits for owner», у рамки — чип
  «Waits for owner». У одного состояния Epic-а теперь одна причина, где бы он ни стоял в очереди (решение владельца,
  приёмка Ticket-а 20, Q2). На Machine с `serve` новая причина ведёт себя как `blocked-tickets`: сначала ход gate queue.
  Run одного Epic-а не меняется: его Epic, ждущий владельца, — `blocked-tickets`, как раньше. п. 4: «Start anyway» есть и
  в окне «Run all accepted»: отказ `runningElsewhere` оставляет окно открытым с причиной и кнопкой, которая повторяет
  старт той же очереди, в том же порядке и Run mode, с `override` для всего Run-а (Q1 приёмки, решение владельца
  2026-11-07 по Ticket-у 14). У окна просьбы агента кнопки нет: очередь агента запускает main после ответа окна, и
  отказ получает Session. Ticket `worfy-autopilot-queue` 21.
