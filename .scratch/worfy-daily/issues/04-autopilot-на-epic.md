# 04 — Autopilot на Epic: цикл Wave-ов, keep-awake, остановка

Type: task
Status: open
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

- [ ] ADR «когда Wave закончена» принят до кода, в нём выбран тип keep-awake.
- [ ] Fake-сценарий проходит целиком: старт → «Run wave 1» → `result` и Ticket-ы Wave 1 done → «Run wave 2» → готовой Wave нет → остановка с причиной `no-ready-wave`. В журнале события идут в том же порядке.
- [ ] Session в `error` останавливает прогон с причиной `session-error`. keep-awake снят, событие в журнале.
- [ ] `powerSaveBlocker.start` вызывается на старте, `stop` — на Stop, на остановке по причине и на `will-quit` (electron подменён).
- [ ] Второй `start` на тот же Project отклоняется, пока прогон идёт.
- [ ] Сообщение пользователя Orchestrator-у прогона и «Send queued» пишутся в журнал событием `human-input` с `source: "worfy"`.
- [ ] В непакованной сборке `start` на Project самого worfy отклоняется понятным текстом. На другом Project (временная папка test-а) прогон стартует.
- [ ] Orchestrator прогона — Session без человека: режим `bypassPermissions`, смена режима отклоняется.
- [ ] Снимки действия Autopilot на Epic в светлой и тёмной теме сверены с F-SPEC.
- [ ] (вручную) На стабильной копии Autopilot проводит одну Wave тестового Project. Агент-наблюдатель через computer use снимает экран раз в 10 минут и каждое касание вне worfy дописывает в журнал событием `human-input` с `source: "observer"`. Результат: ни одного диалога, и касаний человека 0 — или каждое касание записано в «Итог» и стало Ticket-ом.

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
