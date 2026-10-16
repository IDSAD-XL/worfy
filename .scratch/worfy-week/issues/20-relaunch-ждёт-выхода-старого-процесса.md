# 20 — Relaunch Orchestrator-а ждёт выхода старого процесса Claude Code; по таймауту — SIGKILL

Type: task
Status: done — 2026-10-16, [PR #345](https://github.com/IDSAD-XL/worfy/pull/345)
Branch: worfy-week/20
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

- [x] Test с подставным процессом, который игнорирует SIGTERM: после `giveBackNow` новый процесс не
      стартует, пока старый жив. По таймауту старый получает SIGKILL. Новый стартует после его выхода.
      Test проверяет порядок событий «выход старого» → «старт нового», а не длину ожидания.
- [x] Test с подставным процессом, который выходит сразу: новый процесс стартует без добавленной
      задержки. Граница в test-е заметно меньше таймаута из пункта 3; число — в «Итог».
- [x] Очередь сообщений старой Session приходит в новую удержанной, как до правки: существующие
      test-ы `giveBackNow` и relaunch зелёные.
- [x] Сообщение, отправленное Orchestrator-у во время ожидания, доходит до новой Session или остаётся
      в её очереди. В старый процесс оно не уходит.
- [x] Test-ы краснеют на мутантах (намеренно испорченных копиях кода): ожидание выхода убрано;
      SIGKILL по таймауту убран.
- [x] Существующие test-ы Force stop зелёные: `test/contract/autopilot-background.test.ts` (Force stop
      с живыми фоновыми задачами Session, `:423`) и `test/e2e/autopilot.spec.ts` (Force stop во время
      хода, `:485`).
- [ ] (вручную, после влития) На Stable copy — установленной копии worfy — идёт долгий ход настоящего
      Claude Code в прогоне Autopilot. До Force stop записан pid процесса Claude Code:
      `pgrep -lP <pid worfy>`. После ответа Force stop `ps -p <старый pid>` его не находит.
      Orchestrator отвечает на следующее сообщение. Вывод команд — в «Итог».
      Не проверено: шаг владельца на Stable copy после влития.
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

Сделано в ветке `worfy-week/20` (исполнитель, 2026-10-15). Решение — ADR-0064
(`docs/adr/0064-orchestrator-relaunch-waits-for-old-process-exit.md`); ADR-0050 не правился.

- **Как worfy узнаёт о выходе процесса (пункт 1).** Опция SDK `spawnClaudeCodeProcess`: функция
  `watchedSpawn` (`src/main/agent/options.ts`) повторяет запуск SDK по умолчанию из `sdk.mjs` 0.3.289
  (`spawn(command, args, {cwd, stdio: pipe×3, signal, env, windowsHide: true})`, stderr как UTF-8 в
  обработчик Session, `exit` для SDK — после закрытия stderr, не позже 200 ms) и отдаёт
  `ChildProcess` Session через новое поле `QueryRequest.spawned`. Способ без подмены запуска
  оценён и отвергнут: у `Query` нет pid и события выхода, `onProcessSpawned` есть только во
  внутреннем коде SDK, а поиск pid в `~/.claude/sessions` с опросом `kill(pid, 0)` — чтение
  `~/.claude` по таймеру с риском чужого pid.
- **Ожидание.** `Session.exited(ms)` ждёт идущий запуск, потом выход процессов; по таймауту —
  SIGKILL и ещё до 2 s (`KILL_EXIT_MS`), дальше relaunch идёт с предупреждением в лог.
- **Таймаут (пункт 3):** `EXIT_WAIT_MS` = 7 500 ms (`src/main/agent/session.ts`, рядом с
  `HALT_TURN_MS`). SDK шлёт свой SIGKILL через 7 s после `close()`; SIGKILL worfy приходит после
  него и мягкий выход SDK не сокращает.
- **Пока идёт ожидание (пункт 6), отступление от текста Ticket-а.** Новая Session регистрируется
  сразу, но процесс запускает только после выхода старого (`SessionRegistry.start(…, after)`).
  Экран показывает её `starting` с её id; сообщение, отправленное в это время, ложится в её очередь
  и уходит в новый процесс. Вариант «живой Session нет» отвергнут: без id Session экран отвечает
  отказом «The Session is not running», и сообщение не доходит до новой Session (пункт «Готово,
  когда»). Второй relaunch закрывает ждущую Session до старта: она процесса не запускает, следующая
  ждёт выхода того же старого процесса.
- **Ответ Force stop (пункт 7).** `setUnattended` и `giveBackNow` ждут `relaunch` и отвечают после
  старта нового процесса; `src/main/autopilot/run.ts` менять не пришлось, кроме комментариев.
- **Test-ы.** `test/contract/orchestrator-relaunch.test.ts` (9) и новый test в
  `test/contract/autopilot-background.test.ts`; подставной процесс — `node -e` (бинарник Electron
  как Node) из `test/contract/claude-process-stub.ts`, запущенный через тот же `watchedSpawn`.
  Граница test-а «выходит сразу»: новый процесс стартует меньше чем через 1 000 ms после вызова
  relaunch при таймауте 5 000 ms.
- **Сначала красный.** Те же test-ы на коде без ожидания в `relaunch` (`launch(…, undefined)`)
  падают: 6 из 29. Когда relaunch ответил, порядок был `spawn 1, spawn 2` — новый процесс
  стартовал, пока старый был жив, — вместо `spawn 1, exit 1 SIGKILL, spawn 2`.
- **Мутанты** (по test-файлам `orchestrator-relaunch` и `autopilot-background`): ожидание убрано —
  6 красных; SIGKILL убран — 6 красных; ожидание идущего запуска убрано — 1 красный; сообщение во
  время ожидания не держится в очереди — 1 красный; `giveBackNow` не ждёт relaunch — 3 красных.
- **e2e:** `test/e2e/autopilot.spec.ts` — 5 passed (под замком `/tmp/worfy-e2e.lock`).
- **Windows.** Запуск процесса тот же, что у SDK, без веток по платформе. Новое на Windows:
  relaunch ждёт выхода процесса и через 7,5 s шлёт `kill('SIGKILL')` (в Node на Windows это
  TerminateProcess). Нужен gate full на Windows-ПК перед влитием (ADR-0056).
- **Не проверено:** сколько настоящий Claude Code выходит после закрытия stdin (риск «каждый переход
  Autopilot станет дольше») — настоящий Claude Code в этой работе не запускался; ручной пункт на
  Stable copy — шаг владельца после влития; `GATE_SCOPE=all gate.sh full` — делает оркестратор.

### Merge (2026-10-16)

- Windows-ПК (Session «Worfy тесты на ПК», ночь 2026-10-16): на первом head kill через SIGTERM на win32 не давал выхода с сигналом — исправлено в ветке: `IGNORE_TERM_EXIT_SIGNAL` в `test/contract/claude-process-stub.ts` (SIGTERM на win32, SIGKILL на остальных), два test-а `skipIf` win32, четыре — с ожиданием для win32. После фикса два исправленных файла — 27 passed и 2 skipped на win32, `pnpm test` — новых падений против main нет (исключение ADR-0056 до `worfy-windows` 14).
- Конфликт с `worfy-polish` 24 в `src/main/agent/` разрешён merge-коммитом `7d8ff911`, проверен.
- Mac: `GATE_SCOPE=all gate.sh full` на `416a0119` — exit 0, `[gate] зелено (full)`; предупреждение: `src/main/agent/session.ts` 947 → 1077 строк (долг: разделить файл). CI `check` — 0. Squash-merge `99b18c8c`.
- Не проверено: ручной пункт на Stable copy (время выхода настоящего Claude Code) — шаг владельца.
