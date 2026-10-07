# 04 — Session живёт на Machine Project-а и не зависит от окна

Type: task
Status: open
Blocked by: 03
Source: решения владельца 2026-10-07: Q14 (Session, запущенная с другой Machine, живёт на Machine Project-а и не закрывается с окном) и Q2 (обе Machine работают одновременно, общее состояние живое) ([spec.md](../spec.md), «Готово, когда» Epic-а, пункты 2 и 3); [ADR-0053](../../../docs/adr/0053-several-screens-on-one-project.md) (пункт 4 — Session живёт на Machine Project-а; последствие про `agent.start`)

## Что происходит

- Session-ы, которые человек запускает в UI, окну уже не принадлежат.
  - «New session», Resume и запуск на Session Node идут каналами `sessions.new`, `sessions.start`,
    `sessions.resume` (`src/shared/ipc/sessions.ts:81`, `:88`, `:94`; вызовы —
    `src/renderer/shell/sidebar/SessionsSection.tsx:91`, `src/renderer/canvas/nodes/SessionNode.tsx:192`,
    `src/renderer/session/HistoryPopover.tsx:159`).
  - Эти Session-ы и Orchestrator принадлежат приложению: события и views идут всем окнам через
    `toEveryWindow`, закрытие окна их не останавливает, закрываются они с выходом из worfy
    (`src/main/agent/app-node-sessions.ts:1-4`, `:32-33`; `src/main/agent/app-orchestrators.ts:6-9`,
    `:41-42`).
- Канал `agent.start` устроен иначе. Renderer его не вызывает: в `src/renderer` вызовов нет. Его
  зовут только test-ы — `test/e2e/agent.spec.ts:30`, `test/e2e/limits.spec.ts:50`,
  `test/contract/agent-attachments.test.ts:95` и стенд `test/contract/agent-session.test.ts`.
  - События такой Session идут только окну, которое её начало: `windowSink(event.sender)`
    (`src/main/ipc/agent.ts:41-46`, `:138`).
  - Окно ей владеет: `ownership()` закрывает все его Session-ы на `destroyed` окна
    (`agent.ts:53-78`, `:139`). Причина записана в шапке файла (`:1-4`): Session, которую никто не
    видит, держала бы Claude Code запущенным.
  - Это закрепляют test-ы `test/contract/agent-session.test.ts:343` («closing a window closes the
    Sessions it started…») и `:361`.
- Как второй экран видит Session.
  - Прошлое — из файла транскрипта: `SessionPanel` читает его по `sdkSessionId` Session Node-а или
    по Session Orchestrator-а (`src/renderer/session/SessionView.tsx:104-118`) и склеивает с живыми
    событиями без повторов (`joinPastAndLive`, `src/renderer/session/store.ts:211`).
  - Живые события — из одной подписки на `agent.event`; store раскладывает их по `sessionId`
    (`store.ts:1-3`).
  - Очередь сообщений и настройки (модель, effort, режим разрешений) экран, открытый позже,
    спрашивает каналом `agent.controls` (`src/shared/ipc/agent.ts:8-10`).
  - Запуском с двумя окнами это не проверялось: второе окно до Ticket-а 03 не открыть.
- Два экрана пишут в одну Session по очереди.
  - `agent.send` одной Session идёт цепочкой `lastSend` (`agent.ts:125-127`, `:149-155`): сообщения
    доходят в порядке отправки, даже если вложения одного проверяются дольше.
  - Сообщение во время хода ждёт в очереди Session в main (`src/main/agent/queue.ts:1-11`); снимок
    очереди уходит всем окнам событием `queue`. Признака «какой экран написал» нет.
- fake-агент (`WORFY_AGENT=fake`, его ставит `launchApp`) транскрипт не пишет: он только
  регистрирует себя в `<registryHome>/sessions` (`src/main/agent/fake-query.ts:38-39`). В e2e
  прошлое Session берётся из файла-fixture, как в `test/e2e/session-resume.spec.ts:33-52`. Окно,
  открытое после хода, в e2e этот ход без fixture не увидит.

## Что делаем

1. **Session из `agent.start` принадлежит приложению** (Q14; ADR-0053, пункт 4) — как Session-ы
   Session Node-ов и Orchestrator.
   - События — всем клиентам реестра Ticket-а 03 (рассылка `toEveryWindow` после Ticket-а 03).
     Renderer уже разбирает их по `sessionId`. Рассылка приходит в `agentHandlers` параметром,
     как `broadcast` в `app-node-sessions.ts:32`: test-ы подставляют свою.
   - `ownership()` и `windowSink` уходят. Закрытие окна или обрыв соединения Session не
     закрывают. Session закрывается `agent.close` или с выходом из worfy
     (`src/main/agent/app-registry.ts:91-95`, `closeAll` на `will-quit`).
   - Шапка `agent.ts` (`:1-4`) и комментарий `app-orchestrators.ts:6-9` («Unlike the Sessions of
     `agent.start`…») говорят новое правило со ссылкой на ADR-0053.
   - Отдельная подписка на Session по `sessionId` (меньше трафика по сети) — не здесь. Если она
     понадобится для соединений Linked machine-ов, её решает Ticket 08.
2. **Второй экран видит Session целиком.** Session Node, запущенная в окне 1, во втором окне
   показывает прошлое из транскрипта и дальше живые события, без повторов на стыке; очередь и
   настройки — те же. Проверка — e2e на двух окнах (helper второго окна Ticket-а 03). Если e2e
   покажет разрыв или повтор на стыке прошлого и живого во втором окне, правка — в
   `src/renderer/session/store.ts` (`joinPastAndLive`); тогда файл добавляется в «Где в коде».
3. **Session переживает закрытие окна, где её начали.** Окно 1 закрыто — Session в окне 2 не
   `finished`, в неё можно писать, ответ приходит.
4. **Два экрана пишут по очереди.** Сообщения из двух окон во время хода встают в очередь в
   порядке прихода, оба окна видят один снимок очереди и одни и те же prompt-ы в одном порядке.
   Перед правкой прочитать `src/main/agent/queue.ts` целиком — бриф разведки её не разбирал.

Не входит: Terminal (Ticket 05); кнопка «+» вложения и её диалог (`agent.attachPick`,
`agent.ts:159-169` — Ticket 12); сеть (Ticket 08). Признак «кто написал» в Session владелец не
просил — не делаем.

## Готово, когда

- [ ] Contract `test/contract/agent-session.test.ts`: закрытие окна, начавшего Session через `agent.start`, её не закрывает — Session в `agent.list`, её Claude Code не остановлен (`close` не вызван), из другого окна `agent.send` проходит и даёт `result`. Заменяет test-ы `:343` и `:361`.
- [ ] Там же: события Session из `agent.start` получает каждый клиент рассылки, а не только начавшее окно (два подставных получателя видят один и тот же поток).
- [ ] e2e `test/e2e/session-two-windows.spec.ts` (локально, в gate full; fake-агент): «New session» в окне 1, второе окно открыто helper-ом Ticket-а 03. Сообщение из окна 1 — ответ виден в Session Node обоих окон (`session-node-answer`).
- [ ] Там же: окно 1 закрыто — Session Node в окне 2 не `finished` (`session-node-status`); сообщение из окна 2 даёт ответ.
- [ ] Там же: Session, продолженная (Resume) поверх файла транскрипта из fixture в окне 1, во втором окне показывает прошлые ходы один раз и после них новый живой ход из окна 1 — тоже один раз (`transcript-prompt` в Session view).
- [ ] Там же: два сообщения из двух окон во время хода (сценарий fake-агента с долгим ходом из `test/fixtures/agent-scripts/`; подходящего нет — новый) — оба окна показывают одну очередь, а после хода — оба prompt-а в порядке отправки, без смешения текста.
- [ ] `test/e2e/agent.spec.ts` и `test/e2e/limits.spec.ts` зелёные без правок.
- [ ] `grep -n "windowSink\|ownership" src/main` пуст (вывод — в «Итог»).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all gate.sh full` — exit 0.

## Тесты

Сначала падающий test — `test/contract/agent-session.test.ts`: окно, начавшее Session, уничтожено,
а Session жива и отвечает из другого окна. На main `ownership()` её закрывает — test падает. В
«Итог» — как он падал.

- `test/contract/agent-session.test.ts` — владелец-приложение и рассылка для `agent.start`. Стенд
  test-а (`:39-94`) создаёт поддельные окна с `destroy()`; рассылка подставляется параметром
  `agentHandlers`.
- `test/e2e/session-two-windows.spec.ts` — два окна на собранном приложении: живая Session,
  закрытие окна, прошлое и живое, очередь.

Прошлое Session в e2e — файл транскрипта из fixture (способ `test/e2e/session-resume.spec.ts:33-52`):
fake-агент транскрипт не пишет. Селекторы Session Node-а — как в `test/e2e/new-session.spec.ts:199-236`.

## Где в коде

- `src/main/ipc/agent.ts`
- `src/main/agent/app-orchestrators.ts`
- `test/contract/agent-session.test.ts`
- `test/e2e/session-two-windows.spec.ts` (новый)

`src/main/agent/app-orchestrators.ts` — только комментарий `:6-9`. `src/main/agent/app-node-sessions.ts`
и `src/main/agent/queue.ts` — образец и чтение, не правка. `src/renderer/session/store.ts` — только
если e2e покажет разрыв на стыке (п. 2). Helper второго окна берётся из Ticket-а 03 как есть,
`test/e2e/helpers.ts` этот Ticket не правит.

## Итог

Заполняется при закрытии.
