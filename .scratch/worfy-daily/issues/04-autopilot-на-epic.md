# 04 — Autopilot на Epic: цикл Wave-ов, keep-awake, остановка

Type: task
Status: done — 2026-10-06, [PR #39](https://github.com/IDSAD-XL/worfy/pull/39)
Blocked by: 01, 02, 03
Source: [spec.md](../spec.md), тема A, риски 1, 2, 4 и 5; [CONTEXT.md](../../../CONTEXT.md), термины Autopilot и Wave; [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md); Ticket 23 worfy-mvp («Run wave»)

## Что делаем

**Что есть сейчас.** «Run wave» (`ActionLauncher.runWave`, `src/main/actions/launch.ts:134`)
открывает Orchestrator Project и шлёт ему текст из шаблона Project (`:143`; шаблон —
`src/shared/actions/render-template.ts:107`). Конец Wave не приходит событием: launcher только
опрашивает закрытые Session (`launch.ts:154-186`). Цикла «следующая Wave после предыдущей» нет.

**Решение до кода — ADR (номер с 0022): когда Wave закончена и что Autopilot делает дальше.**
Предложение:

- Wave закончена, когда Orchestrator Session перешла из `busy` в `idle` с `result` без ошибки и в
  модели workflow ни один Ticket этой Wave не в работе.
- Тогда Autopilot берёт новую готовую Wave (`src/shared/workflow/waves.ts`) и шлёт «Run wave» по
  шаблону Project.
- Статус Ticket-ов ставит сам агент через `ticket` (`launch.ts:20-21`). worfy статус не пишет
  (ADR-0002).

В тот же ADR — какой тип keep-awake выбран и что с закрытой крышкой.

**`src/shared/autopilot/cycle.ts`** — чистая функция. Вход: состояние прогона и событие (`result`,
`error` или `idle` Session, `workflow.changed`, Stop). Выход: следующее действие — послать
«Run wave N», ждать или остановиться с причиной. Причины остановки:

- готовой Wave нет: Epic закончен или всё заблокировано;
- Session в `error` — её очередь держится до «Send queued» (`src/main/agent/session.ts:10-11`);
- пользователь нажал Stop;
- приложение закрывается.

**`src/main/autopilot/run.ts`** — сам прогон:

- Orchestrator Project запускается как Session без человека (Ticket 02);
- подписка на состояние этой Session и на `workflow.changed`;
- каждый шаг пишется в журнал (Ticket 01), туда же — события `refused-dialog` из Ticket-а 02;
- любое действие пользователя в Session прогона пишется событием `human-input` с `source: "worfy"`:
  сообщение Orchestrator-у или Subagent-у, «Send queued», смена режима или модели, ручной
  перезапуск Session. Stop прогона пишется как `run-stopped` с причиной `user-stop`;
- не больше одного прогона на Project;
- Autopilot над самим worfy в непакованной сборке (`app.isPackaged === false`) отклоняется понятным
  текстом. «Сам worfy» — Project, чей корень совпадает с корнем основного репозитория запущенной
  сборки (`app.getAppPath()`). Иначе агенты прогона пересобирают приложение, в котором идёт прогон.

**`src/main/autopilot/power.ts`** — keep-awake:

- `powerSaveBlocker.start` на старте прогона;
- `stop` на остановке и на `will-quit`. Подписка на `will-quit` живёт внутри `power.ts`, по образцу
  `src/main/agent/app-registry.ts:66`, чтобы blocker не утёк.
- Тип `'prevent-app-suspension'` не держит Mac бодрым при закрытой крышке. Выбор записывается в ADR.

**IPC** — `src/shared/ipc/autopilot.ts` и `src/main/ipc/autopilot.ts`:

- `start(projectId, epic)` и `stop(projectId)`;
- состояние прогона: `running` / `stopped` с причиной, номер Wave;
- рассылка изменений.

**UI** — действие на Epic `src/renderer/canvas/actions/AutopilotAction.tsx`:

- кнопки «Autopilot» и «Stop autopilot»;
- строка состояния, например «Wave 3 · running» или «stopped: no ready wave».

Autopilot над самим worfy запускается только на стабильной копии (Ticket 03). Ручная проверка ниже
идёт на ней.

## Готово, когда

- [x] ADR «когда Wave закончена» принят до кода, в нём выбран тип keep-awake.
- [x] Fake-сценарий проходит целиком: старт → «Run wave 1» → `result` и Ticket-ы Wave 1 done → «Run wave 2» → готовой Wave нет → остановка с причиной `no-ready-wave`. В журнале события идут в том же порядке.
- [x] Session в `error` останавливает прогон с причиной `session-error`. keep-awake снят, событие в журнале.
- [x] `powerSaveBlocker.start` вызывается на старте, `stop` — на Stop, на остановке по причине и на `will-quit` (electron подменён).
- [x] Второй `start` на тот же Project отклоняется, пока прогон идёт.
- [x] Сообщение пользователя Orchestrator-у прогона и «Send queued» пишутся в журнал событием `human-input` с `source: "worfy"`.
- [x] В непакованной сборке `start` на Project самого worfy отклоняется понятным текстом. На другом Project (временная папка test-а) прогон стартует.
- [x] Orchestrator прогона — Session без человека: режим `bypassPermissions`, смена режима отклоняется.
- [x] Снимки действия Autopilot на Epic в светлой и тёмной теме сверены с F-SPEC.
- [ ] (вручную) На стабильной копии Autopilot проводит одну Wave тестового Project. Агент-наблюдатель через computer use снимает экран раз в 10 минут и каждое касание вне worfy дописывает в журнал событием `human-input` с `source: "observer"`. Результат: ни одного диалога, и касаний человека 0 — или каждое касание записано в «Итог» и стало Ticket-ом. (2026-10-07: по журналам двух прогонов диалогов и касаний 0, наблюдатель касаний не запускался — подраздел [«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).)

## Тесты

- `test/unit/autopilot-cycle.test.ts` (новый) — переходы `cycle.ts`.
- `test/unit/autopilot-power.test.ts` (новый) — мок `electron.powerSaveBlocker`. Образец мока — `test/unit/notify.test.ts`.
- `test/contract/autopilot.test.ts` (новый) — прогон на fake-агенте (`WORFY_AGENT=fake`, сценарий `test/fixtures/agent-scripts/autopilot-waves.jsonl`) и на копии Epic во временной папке. Статусы Ticket-ов test меняет сам, как это делал бы агент.
- `test/e2e/autopilot.spec.ts` (новый) — действие на Epic, строка состояния, Stop.
- Сначала падающий test: после `result` Wave 1 и done её Ticket-ов следующая Wave не запускается.

## Где в коде

- `src/shared/autopilot/cycle.ts` (новый)
- `src/main/autopilot/run.ts` (новый)
- `src/main/autopilot/power.ts` (новый)
- `src/shared/ipc/autopilot.ts` (новый)
- `src/main/ipc/autopilot.ts` (новый)
- `src/renderer/canvas/actions/AutopilotAction.tsx` (новый)
- `src/main/actions/launch.ts`
- `test/fixtures/agent-scripts/autopilot-waves.jsonl` (новый)
- `test/unit/autopilot-cycle.test.ts` (новый)
- `test/unit/autopilot-power.test.ts` (новый)
- `test/contract/autopilot.test.ts` (новый)
- `test/e2e/autopilot.spec.ts` (новый)

## Итог

Сделано в ветке `worfy-daily/04`.

- **Решение до кода** — [ADR-0024](../../../docs/adr/0024-autopilot-wave-end-and-keep-awake.md):
  Wave закончена, когда ход Orchestrator-а прогона закончился `result` без ошибки и без прерывания и
  в свежем чтении модели workflow ни один Ticket этой Wave не `claimed`. Ticket в работе после хода —
  прогон ждёт `workflow.changed` или новый ход; через 10 минут без них — `wave-unfinished`. Готовая
  Wave, совпавшая с только что законченной, — `no-progress`. keep-awake —
  `prevent-app-suspension`; при закрытой крышке Mac засыпает, worfy этого не обходит.
- **Цикл** — `src/shared/autopilot/cycle.ts`, чистая функция `step(state, event)`. Причины остановки:
  `no-ready-wave`, `no-progress`, `wave-unfinished`, `session-error`, `turn-error`, `interrupted`,
  `session-closed`, `send-failed`, `workflow-error`, `user-stop`, `app-quit`.
- **Нумерация Wave.** В журнале и строке состояния Wave-ы считаются по прогону с 1. Номер Wave плана
  (`{wave}` шаблона) уходит только в текст «Run wave». Так номер в журнале не зависит от того, как
  `readyWaveNumber` сопоставит частично сделанную Wave с таблицей плана.
- **Orchestrator прогона.** `Orchestrators.setUnattended` (`src/main/agent/orchestrator.ts`)
  перезапускает Session Orchestrator-а без человека с `resume` той же SDK session; во время хода
  старт прогона отклоняется. После остановки Orchestrator перезапускается обычной Session сразу,
  а если идёт ход — когда ход закончится. Настройки Session без человека в `session-settings.json`
  не пишутся (оговорка из «Итог» Ticket-а 02). «New conversation» во время прогона отклоняется.
  При `app-quit` Orchestrator обратно не перезапускается: Session-ы и так закрываются с приложением.
- **Действия человека.** `SessionRegistry.noteInput` / `observeInput` (`src/main/agent/session.ts`)
  и вызовы в `src/main/ipc/agent.ts`: отправка сообщения, «Send queued», смена модели, effort или
  режима (и отклонённая тоже, ADR-0022), Interrupt, закрытие Session, удаление сообщения из
  очереди, ответ на запрос разрешения. Прогон пишет их событием `human-input` с `source: "worfy"`,
  только для своей Session. Отдельного канала «сообщение Subagent-у» в worfy нет: такое сообщение —
  то же `agent.send` в Session Orchestrator-а. «Ручной перезапуск» — это `agent.close` (пишется) или
  «New conversation» (отклоняется во время прогона).
- **«Run wave» руками** во время прогона на этом Project отклоняется в main
  (`ActionLauncher.runWave`, текст `AUTOPILOT_RUNNING_HINT`); кнопка остаётся активной и показывает
  причину после щелчка. Сделать её неактивной заранее — правка `EpicActions.tsx`, вне следа.
- **Сам worfy.** `selfProjectRefusal` (`src/main/autopilot/run.ts`): в непакованной сборке
  отклоняется Project, чей корень — `app.getAppPath()` или любой checkout того же репозитория
  (совпадает `git rev-parse --git-common-dir`).
- **Выход из приложения во время прогона.** `before-quit` откладывает выход, пока прогоны не
  запишут `run-stopped` с `app-quit`, не дольше 3 секунд (`src/main/ipc/autopilot.ts`).
- **«stopped» только после конца.** Прогон считается идущим (`running`, причина `null`), пока не
  записан `run-stopped`, не снят keep-awake и не возвращён Orchestrator. Первый CI run поймал
  гонку: состояние говорило `stopped` раньше, чем строка `run-stopped` попадала в журнал. Test
  «reports a run stopped only once its end is journaled and keep-awake released» (медленный журнал)
  краснеет на мутанте, который берёт статус из фазы цикла.
- **UI.** `AutopilotAction.tsx`: «Autopilot» активна по тому же вердикту, что «Run wave»
  (`useRunWaveState`), и пока в Project нет прогона. Строка состояния стоит под кнопкой, а не
  рядом: в узкой рамке Epic рядом с «Run wave» она съедала заголовок Epic-а целиком (видно на первом
  снимке). Снимки `autopilot-{idle,running,stopped}-{light,dark}.png` — в выводе
  `test/e2e/autopilot.spec.ts`. Макета Autopilot в F-SPEC нет; сверено со стилем действий F-SPEC:
  вторичная кнопка `w-action`, подпись — `--text-11` и `--text-secondary`, первичная — только
  «Run wave».
- **Файлы вне «Где в коде».** Без них обязательный исход недостижим:
  `src/main/agent/orchestrator.ts` (Orchestrator без человека и обратно),
  `src/main/agent/session.ts` и `src/main/ipc/agent.ts` (`human-input` от действий в UI),
  `src/main/ipc/actions.ts` (экспорт общего launcher-а: Autopilot шлёт Wave-ы через него);
  после ревью ещё `src/main/agent/queue.ts` (перенос очереди), `src/main/ipc/card-api.ts`
  (`human-input` от сообщения Card) и `test/unit/autopilot-run.test.ts`.
- **Первый test и как он падал.** Первым написан `test/unit/autopilot-cycle.test.ts`. Без
  `cycle.ts` он падал на импорте. Test из Ticket-а «после `result` Wave 1 и done её Ticket-ов следующая
  Wave не запускается» проверен мутантом: `evaluate` возвращает ожидание вместо `send-wave` — красные
  4 test-а, среди них «after the result of Wave 1 with its Tickets done, sends the next Wave».
- **Мутанты** (каждый краснит хотя бы один test): настройки Session без человека сохраняются;
  `launch` не передан в `registry.start`; нет `noteInput` у отправки, «Send queued», смены настроек;
  `human-input` любой Session; keep-awake не снимается; нет защиты от двух одновременных `start`;
  «Run wave» руками разрешён; Orchestrator не возвращается обычной Session; возврат во время хода;
  `refused-dialog` пишется другим видом события.
- **Доработка по ревью PR #39.**
  - **Старт при ходе Orchestrator-а** отклоняется (`ORCHESTRATOR_IN_TURN`), и когда Orchestrator
    обычный, и когда он ещё без человека после Stop: ход остановленного прогона не кончился. Раньше
    второй случай проходил, сбрасывал отложенный возврат и слал «Run wave» в занятую Session.
  - **Старт при непустой очереди Orchestrator-а** отклоняется (`ORCHESTRATOR_HAS_QUEUE`). Сообщения
    в очереди писал человек для обычной Session. Перенесённые в Session без человека, они ушли бы
    в `bypassPermissions` по «Send queued», а «Run wave» мог встать в удержанную очередь и не уйти.
  - **Возврат Orchestrator-а переносит очередь.** Перезапуск обычной Session после прогона забирает
    сообщения из очереди старой Session и кладёт их в новую, удержанными, как были
    (`Session.handOverQueue` / `adoptQueue`, `MessageQueue.takeAll` / `adopt`). Ошибка старой
    Session не переносится: новая Session запускает новый процесс Claude Code, и Node Orchestrator-а
    показывает `starting`, затем `idle`. Текст ошибки остаётся в журнале (`session-error`) и в строке
    состояния Autopilot. Это принятое решение.
  - **Какой `result` заканчивает Wave.** «Run wave» может встать в очередь за сообщением человека
    (`delivery: 'queued'`). Прогон считает ходы Session по событиям `prompt` в их порядке и
    запоминает ход, который начал prompt Wave. Конец Wave — `result` этого хода или более позднего
    (поздние — ходы человека в ожидании, как в ADR-0024). `result` более раннего хода Wave не
    заканчивает. Interrupt такого хода всё же останавливает прогон с `interrupted`: очередь удержана,
    и Wave сама не пойдёт. Wave, которая при остановке прогона ещё ждёт в очереди, вынимается из неё:
    иначе она прошла бы потом без прогона, и её ход никто бы не отслеживал.
  - **Сообщение Card**, которое человек подтвердил кнопкой «Send», пишется `human-input`
    («sent a message from a Card», `sendFromCard` в `src/main/ipc/card-api.ts`). Для Orchestrator-а
    без человека диалог не показывается вовсе (`confirmAsk` отказывает сразу, это `refused-dialog`).
    Запись нужна для диалога, открытого до старта прогона и подтверждённого после.
  - **Session упала, пока прогон открывал watch workflow**: watch закрывается сразу, прогон не
    остаётся в списке, `start` отвечает остановленным состоянием.
  - **Tests.** `test/unit/autopilot-run.test.ts` — порядок событий Session без Claude Code: ход
    человека перед Wave в очереди, `result` во время отправки, Interrupt, Stop с Wave в очереди,
    падение во время watch. В `test/contract/autopilot.test.ts`: отказ старта в ходе и после Stop,
    отказ при очереди, перенос очереди, `app-quit` без перезапуска, `human-input` для Interrupt,
    закрытия, удаления из очереди, ответа на запрос разрешения и сообщения Card. Файлы `issues/`
    сверяются побайтно с тем, что писал сам test от имени агента. e2e сверяет дерево
    `WORFY_CLAUDE_HOME` до и после прогона. Каждое новое поведение проверено мутантом: 16 мутантов,
    каждый краснит хотя бы один test (в том числе мутант, который на `wave-finished` переписывает
    `Status:` Ticket-ов).
- **Узкий круг исправления по второму ревью PR #39.**
  - **Ход человека, законченный нормально после Interrupt.** Interrupt удерживает очередь, но ход,
    который всё же закончился без ошибки, приходит с `interrupted: false`. Раньше такой `result`
    игнорировался: Wave оставалась в удержанной очереди, Session — в `idle`, прогон — в фазе `turn`
    без таймера, с включённым keep-awake, пока его не остановят вручную. Теперь `result` хода раньше
    Wave, после которого Wave ждёт в удержанной очереди (`queued().paused`), останавливает прогон с
    `interrupted`, и Wave вынимается из очереди. Очередь читается, когда прогон обрабатывает
    `result` в своём порядке, а не в момент события: если человек успел снять удержание и Wave
    пошла, прогон продолжается.
  - **«Или более поздний ход» в конце Wave** (`turn >= waveTurn`, ADR-0024: новый ход во время
    ожидания заканчивается своим `result`) прежде не был покрыт test-ом: заявление «каждое новое
    поведение проверено мутантом» для этого правила было неверным. Добавлен test.
  - **Tests** в `test/unit/autopilot-run.test.ts`: «a person's turn that finishes normally after an
    Interrupt, leaving the Wave in the held queue, stops the run», «a held queue resumed before the
    run handles the person's result does not stop the run», «a new turn while the run settles ends
    the Wave with its own result (ADR-0024)». Мутанты, каждый краснит свой test: без проверки
    удержанной очереди; `turn === waveTurn`; очередь читается в момент события; проверка без
    `paused`.

не проверено: пункт «(вручную) На стабильной копии Autopilot проводит одну Wave тестового Project»
с агентом-наблюдателем. По брифу настоящий Autopilot на настоящем Claude Code запускает
Orchestrator из стабильной копии после Wave 3; экран в эту ночь занят ручными проверками.
2026-10-07 проверена только часть из журнала, наблюдатель касаний не запускался — подраздел
[«Ручная проверка 2026-10-07»](#ручная-проверка-2026-10-07).

не проверено: выход из приложения во время прогона (`before-quit`, ожидание до 3 секунд) — test-а нет;
keep-awake на `will-quit` проверен только unit-test-ом `KeepAwake` над подменённым Electron.

Замечено вне Ticket-а: в e2e Node Orchestrator-а лежит поверх рамки Epic (Ticket 10, рамки Epic
поверх Node-ов).


### Ручная проверка 2026-10-07

Проверял агент, ночь 2026-10-07 (проверка M2 второго круга ручных проверок), только чтение журналов
прогонов `2026-10-07T00-32-09-524Z-66ddaf` (Epic `worfy-week`, 4 Wave) и `…-b80351` (Epic
`worfy-daily`, 3 Wave) на Stable copy из 5060858.

- Часть из журнала: `refused-dialog` 0 и `human-input` 0 в обоих журналах. Код пишет оба события:
  `human-input` с `source: "worfy"` — `src/main/autopilot/run.ts:359`, `refused-dialog` — `:411`.
- Не проверено: агент-наблюдатель (`source: "observer"`) не запускался — нужна Wave под наблюдением
  с её начала, а оба прогона к началу проверки уже шли или кончились. Делать на следующем прогоне
  Autopilot. Там же впервые проверятся Interrupt, удерживающий очередь, и ход без ошибки с
  `interrupted: false`.
- Вердикт: пункт «(вручную)» остаётся `[ ]`.
