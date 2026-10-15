# 20 — Relaunch Orchestrator-а ждёт выхода старого процесса Claude Code; по таймауту — SIGKILL

Type: task
Status: blocked — ждёт gate full на Windows-ПК (ADR-0056, пункт 2): PR #345 VERIFIED по Mac, Windows-ПК выключен
Blocked by: —
Source: решение владельца 2026-10-12; `.scratch/worfy-week/issues/17-stop-в-autopilot-прерывает-orchestrator.md:214`

## Что происходит

Приоритет — low: так решил владелец.

- Orchestrator — главная Session Project-а. Autopilot — режим, в котором Orchestrator сам ведёт
  Ticket-ы без человека. На время прогона Autopilot Session Orchestrator-а запущена в режиме «без
  человека», после прогона — снова в обычном.
- Смена режима — это relaunch: старый процесс Claude Code закрывается, новый стартует и продолжает ту
  же сохранённую сессию. worfy запускает Claude Code через Claude Agent SDK и передаёт ему опцию
  `resume` (`src/main/agent/options.ts:247`). SDK передаёт её Claude Code флагом `--resume`.
- Force stop — пункт меню «⋯» у кнопки Autopilot: остановить прогон сразу и прервать ход
  Orchestrator-а. Ход — работа агента над одним сообщением. Прерывание ввёл Ticket 17 этого Epic-а
  (Stop в Autopilot прерывает Orchestrator). Ticket 18 (обычный Stop не прерывает ход) оставил
  прерывание только в Force stop.
- Путь Force stop — `Autopilot.interruptAndGiveBack` (`src/main/autopilot/run.ts:1074-1095`):
  1. `Session.halt` (`src/main/agent/session.ts:445-466`) прерывает ход и ждёт его конца не дольше
     `HALT_TURN_MS` — 15 s (`session.ts:219`). После таймаута ход может ещё идти.
  2. `Orchestrators.giveBackNow` (`src/main/agent/orchestrator.ts:264-272`) делает relaunch (`:269`).
- Relaunch — `Orchestrators.relaunch` (`orchestrator.ts:456-476`). Он закрывает старую Session
  (`:463`) и в том же синхронном шаге запускает новую (`:468`). Новая Session сразу стартует процесс
  Claude Code: `SessionRegistry.start` (`session.ts:834-867`) → `Session.start` (`:360-364`) → `begin`
  (`:562-585`).
- `Session.close` (`session.ts:520-535`) зовёт `close()` у запроса SDK (`:528`) и возвращается сразу.
  Выхода процесса worfy не ждёт. Узнать о выходе ему нечем: у `QueryHandle` есть только
  `close(): void` (`session.ts:90-102`).
- Что делает `close()` в SDK `@anthropic-ai/claude-agent-sdk` 0.3.289: 2 s ждёт выхода процесса, затем
  шлёт SIGTERM, ещё через 5 s — SIGKILL. Это прочитано в минифицированном `sdk.mjs` и запуском не
  проверено. Значит, старый процесс может жить до 7 s рядом с новым.
- Следствие: после таймаута `halt` старый процесс ещё ведёт ход и пишет транскрипт сессии, а новый уже
  продолжает ту же сессию и пишет в тот же транскрипт. К чему это приводит на настоящем Claude Code,
  не проверено («Итог» Ticket-а 17, строки 211–213).
- Существующие test-ы этого не видят: у подставного агента процесса нет
  (`src/main/agent/fake-query.ts:447`).
- Правило «два процесса не пишут один транскрипт» в worfy уже есть: `SessionRegistry.start` отклоняет
  `resume` сессии, которую ведёт живая Session (`session.ts:835-837`). Но закрытая Session перестаёт
  считаться живой сразу, до выхода её процесса (`session.ts:854`).
- Владелец решил 2026-10-12: перед relaunch дождаться выхода старого процесса, по таймауту — SIGKILL.

## Что делаем

1. **Session знает, когда вышел её процесс.** `Session.close()` остаётся синхронным. У Session
   появляется способ дождаться выхода процесса Claude Code. Как узнать о выходе — выбирает исполнитель
   и записывает в «Итог». Кандидат — опция SDK `spawnClaudeCodeProcess`
   (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2444`): процесс запускает сам worfy и держит
   его — событие `exit`, `kill(signal)`, `exitCode` (интерфейс `SpawnedProcess`, `sdk.d.ts:9437`).
   Запуск через SDK собран в `sdkQueryFactory` (`src/main/agent/app-registry.ts:48-50`).
2. **Relaunch ждёт выхода.** `Orchestrators.relaunch` закрывает старую Session, ждёт выхода её
   процесса и только потом запускает новую. Очередь сообщений переходит новой Session, как сейчас
   (`handOverQueue`, `orchestrator.ts:460`; `adoptQueue`, `:472`).
3. **Таймаут и SIGKILL.** Процесс не вышел за отведённое время — worfy шлёт ему SIGKILL, ждёт выхода
   и запускает новую Session. Время — константа рядом с `HALT_TURN_MS`. Значение выбирает исполнитель
   и записывает в «Итог». Ориентир: SDK сам шлёт SIGKILL через 7 s после `close()`.
4. **Процесс вышел сразу — задержки нет.** Новая Session стартует, как только пришёл выход старого
   процесса. Постоянной паузы нет.
5. **Все вызовы relaunch.** Кроме `giveBackNow`, relaunch зовут `setUnattended` (`orchestrator.ts:239`,
   `:252`) и `relaunchIfFree` (`:491`). Ожидание живёт в самом `relaunch` и действует для всех.
6. **Пока идёт ожидание.** Живой Session у Orchestrator-а нет. Экран показывает Orchestrator как
   запускающийся (`starting`), а не как ошибку. Сообщение, отправленное в это время, не теряется и не
   уходит в старый процесс. Второй relaunch или закрытие Project-а в это время не запускают второй
   процесс.
7. **Ответ Force stop.** `giveBackNow` отвечает после старта новой Session. Поэтому строка журнала
   прогона `orchestrator-returned` (`run.ts:1092`) и ответ `forceStop` (`run.ts:643-651`) приходят
   после него, а не после закрытия старой Session.
8. **ADR.** Порядок «выход старого процесса, затем старт нового» дописывается в ADR-0050 (решение
   Ticket-а 17 о прерывании Orchestrator-а) или идёт новым ADR. Это решается при claim — когда
   исполнитель берёт Ticket в работу.

## Готово, когда

- [ ] Test с подставным процессом, который игнорирует SIGTERM: после `giveBackNow` новый процесс не
      стартует, пока старый жив. По таймауту старый получает SIGKILL. Новый стартует после его выхода.
      Test проверяет порядок событий «выход старого» → «старт нового», а не длину ожидания.
- [ ] Test с подставным процессом, который выходит сразу: новый процесс стартует без добавленной
      задержки. Граница в test-е заметно меньше таймаута из пункта 3; число — в «Итог».
- [ ] Очередь сообщений старой Session приходит в новую удержанной, как до правки: существующие
      test-ы `giveBackNow` и relaunch зелёные.
- [ ] Сообщение, отправленное Orchestrator-у во время ожидания, доходит до новой Session или остаётся
      в её очереди. В старый процесс оно не уходит.
- [ ] Test-ы краснеют на мутантах (намеренно испорченных копиях кода): ожидание выхода убрано;
      SIGKILL по таймауту убран.
- [ ] Существующие test-ы Force stop зелёные: `test/contract/autopilot-background.test.ts` (Force stop
      с живыми фоновыми задачами Session, `:423`) и `test/e2e/autopilot.spec.ts` (Force stop во время
      хода, `:485`).
- [ ] (вручную, после влития) На Stable copy — установленной копии worfy — идёт долгий ход настоящего
      Claude Code в прогоне Autopilot. До Force stop записан pid процесса Claude Code:
      `pgrep -lP <pid worfy>`. После ответа Force stop `ps -p <старый pid>` его не находит.
      Orchestrator отвечает на следующее сообщение. Вывод команд — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. `GATE_SCOPE=all gate.sh full` (полный прогон
      проверок проекта, включая e2e) — зелёный.

## Тесты

Сначала падающий test: подставной процесс игнорирует SIGTERM, а relaunch запускает новый процесс
сразу. В «Итог» — как test падал.

Подставной процесс — настоящий дочерний процесс, а не подставной агент `fakeQueryFactory`: у того
процесса нет. Например, `node -e` с пустым обработчиком SIGTERM и таймером, который не даёт процессу
выйти. Второй вариант выходит сразу. Test подключает процесс тем же способом, который выберет пункт 1
раздела «Что делаем». Каждый test завершает свои процессы сам, в том числе при падении.

Где: `test/contract/orchestrator.test.ts` или новый файл рядом; путь Autopilot —
`test/contract/autopilot-background.test.ts`. Время в test-ах задаётся малыми таймаутами через
зависимости, как `haltTurnMs` (`src/main/autopilot/run.ts:203`), без ожидания 15 s.

## Где в коде

- `src/main/agent/orchestrator.ts` — `relaunch` (`:456-476`), `giveBackNow` (`:264-272`),
  `setUnattended` (`:228-256`), `launch` (`:350-372`).
- `src/main/agent/session.ts` — `halt` (`:445-466`), `HALT_TURN_MS` (`:219`), `close` (`:520-535`),
  `QueryHandle` (`:90-102`), `SessionRegistry.start` (`:834-867`).
- `src/main/agent/app-registry.ts` — `sdkQueryFactory` (`:48`).
- `src/main/agent/options.ts` — опции SDK; `resume` — `:247`.
- `src/main/autopilot/run.ts` — `interruptAndGiveBack` (`:1074-1095`), `forceStop` (`:643-651`).
- `test/contract/orchestrator.test.ts`, `test/contract/autopilot-background.test.ts`,
  `test/unit/autopilot-run.test.ts`, `test/e2e/autopilot.spec.ts`.
- `docs/adr/0050-autopilot-user-stop-interrupts-orchestrator.md`.

## Вне скоупа

- Закрытие приложения и `SessionRegistry.closeAll` (`session.ts:879-881`).
- Session-ы, кроме Session Orchestrator-а.
- `startOver` (`orchestrator.ts:443-449`): он начинает новую сессию без `resume`, общий транскрипт
  два процесса не пишут.
- Долг Ticket-а 17: если relaunch упал, переданная очередь сообщений теряется («Итог» Ticket-а 17,
  строки 208–209).

## Риски

- Force stop становится дольше: до 15 s `halt` и затем ожидание выхода. Всё это время кнопка
  показывает «Stopping…». e2e Force stop уже нестабилен под нагрузкой (`test/e2e/autopilot.spec.ts:485`;
  запись в `HANDOFF.md`, раздел «Риски и долги»).
- Старт и конец каждого прогона Autopilot тоже идут через relaunch. Если простаивающий процесс
  Claude Code после `close()` выходит не сразу, каждый переход станет дольше. Измерить на настоящем
  Claude Code и записать в «Итог».
- `spawnClaudeCodeProcess` меняет способ запуска Claude Code. Окружение процесса, путь к исполняемому
  файлу (`options.ts:244`) и запуск из собранного `.app` должны остаться прежними: это проверяет gate
  full (`test:e2e`, `test:package`).
- На Windows сигнала SIGTERM нет, и ветка `close()` в SDK для `win32` другая. Проверка на Windows — в
  Epic-е `worfy-windows` (полный порт worfy под Windows).

## Итог
