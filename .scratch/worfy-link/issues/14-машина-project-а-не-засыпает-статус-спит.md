# 14 — Machine Project-а не засыпает, пока подключены Linked machine-ы; статус «спит»

Type: task
Status: claimed — 2026-10-08
Blocked by: 02
Source: решения владельца 2026-10-07: Q5 (пока подключена Linked machine, Machine Project-а не засыпает; переключатель) и Q17 (уснувшая Machine — статус «спит», Wake-on-LAN позже) ([spec.md](../spec.md)); [ADR-0053](../../../docs/adr/0053-several-screens-on-one-project.md)

## Что происходит

- Не давать машине уснуть worfy сейчас умеет только на время прогона Autopilot.
  - `KeepAwake` (`src/main/autopilot/power.ts:41-70`) держит один `powerSaveBlocker` от старта прогона до его конца. Создаёт его `sharedAutopilot` (`src/main/ipc/autopilot.ts:74`), запускает прогон (`src/main/autopilot/run.ts:307-308`). На `will-quit` blocker тоже снимается (`power.ts:10-12`, `:55`).
  - Тип blocker-а — `prevent-display-sleep` (`:15`): не спят ни система, ни экран. Autopilot-у нужен и экран: агенты Wave гоняют e2e и `gate full` (`:2-6`). С закрытой крышкой Mac засыпает всё равно (`:7-8`).
  - Тип зашит: `PowerDeps.blocker.start` принимает только `KEEP_AWAKE_TYPE` (`:20`).
- `powerMonitor` в `src` не используется (grep). О сне и пробуждении машины worfy не знает.
- После Ticket-а 02 («Link a machine», список Linked machine-ов, переключатель доступа) у Linked machine два состояния: «в сети» и «недоступна». Ticket 09 показывает то же состояние у Project-ов в боковой панели. Уснувшая машина для второй неотличима от выключенной.
- `test/unit/autopilot-power.test.ts` подменяет `powerSaveBlocker` и `will-quit` (`:15`, `:39`) — образец для test-ов этого Ticket-а.

## Что делаем

1. **Blocker связи** (Q5 — пока подключена Linked machine, машина не засыпает; есть переключатель). Машина держит свой blocker, пока выполнены три условия:
   - к ней сейчас подключена хотя бы одна Linked machine — соединение Ticket-а 01 (сервер связи Machine-ов) прошло проверку токена;
   - включён переключатель «Linked machines can work with my Projects» (Ticket 02). Без доступа Linked machine-е на этой машине делать нечего. Это условие — определение Ticket-а, владелец подтверждает при claim;
   - включён новый переключатель «Keep this computer awake while linked machines are connected». По умолчанию он включён: так звучит решение Q5, а переключатель нужен, чтобы это выключить. Хранится рядом с переключателем доступа Ticket-а 02 и стоит в том же месте UI.
2. **Какой blocker.** Тип `prevent-app-suspension`: система не спит, экран может гаснуть. Linked machine-е экран машины Project-а не нужен. Autopilot держит свой `prevent-display-sleep` отдельно, как раньше.
   - Blocker один на все соединения, а не по одному на каждое.
   - Снимается сразу, как только условие перестало выполняться: последняя Linked machine отключилась или отозвана, выключен любой из двух переключателей. Снимается и на `will-quit`.
   - Реализация — `KeepAwake` с типом в параметре. По умолчанию тип прежний, `prevent-display-sleep`, так что Autopilot не меняется.
3. **Сообщение перед сном** (Q17 — уснувшую машину Linked machine-ы показывают как «спит»).
   - На `powerMonitor` `suspend` машина шлёт всем подключённым Linked machine-ам служебное сообщение «засыпаю» через служебный канал Ticket-а 01.
   - Получатель ставит этой Machine состояние «спит» и держит его, пока соединение не вернётся. Обрыв соединения после сообщения «спит» не меняет.
   - На `resume` машина сообщает «проснулась» тем, с кем соединение уцелело. С остальными соединение восстанавливается по правилам Ticket-а 02. Вернулось соединение — «в сети».
   - Сообщение не дошло (сон оказался быстрее сети) — вторая машина показывает «недоступна», как без этого Ticket-а.
   - Успевает ли сообщение уйти до сна на macOS, проверяет этот Ticket (раздел «Тесты»). Результат — в «Итог».
4. **Третье состояние.** «спит» — третье значение состояния Linked machine рядом с «в сети» и «недоступна», в `src/shared/ipc/link.ts`. Его показывают все места, где состояние уже видно: список Linked machine-ов (Ticket 02) и, если Ticket 09 уже влит, группы Project-ов в боковой панели. Если Ticket 09 ещё не влит, он берёт третье значение сам.

Не входит: Wake-on-LAN (Q17 — позже). Держать включённым экран — это blocker Autopilot-а. Запрет сна при закрытой крышке worfy не делает, как и сейчас.

## Готово, когда

- [x] Unit `test/unit/link-power.test.ts` (новый, `PowerDeps` подменены, как в `test/unit/autopilot-power.test.ts`). Первая подключённая Linked machine запускает один blocker типа `prevent-app-suspension`, вторая не запускает второй. Blocker снимается сразу: при отключении последней Linked machine, её отзыве, выключении переключателя доступа и нового переключателя. При выключенном новом переключателе подключение blocker не запускает. `will-quit` снимает blocker.
- [x] Unit там же: прогон Autopilot и связь держат каждый свой blocker. Конец прогона не снимает blocker связи, и наоборот. `test/unit/autopilot-power.test.ts` зелёный без правок.
- [x] Unit там же, две Machine в одном процессе vitest (стенд Ticket-а 01). `suspend` на A — B видит у A «спит». Разрыв соединения после этого «спит» не меняет. Разрыв без сообщения — «недоступна». Новое соединение — «в сети».
- [x] e2e `test/e2e/linked-sleep.spec.ts` (новый, локально в gate full): два worfy, связанные helper-ом Ticket-а 02. `powerMonitor.emit('suspend')` в main A через `app.evaluate` — в списке Linked machine-ов B у A состояние «спит» (по `data-testid`). `emit('resume')` — снова «в сети». Новый переключатель виден в UI и по умолчанию включён; выключенный, он остаётся выключенным после перезапуска.
- [ ] Команда на Mac: dev-сборка и Stable copy связаны, доступ включён только у Stable copy. `pmset -g assertions` показывает `PreventUserIdleSystemSleep` у pid Stable copy и не показывает у pid dev-сборки. После отзыва связи или выключения нового переключателя assertion у Stable copy нет. Вывод — в «Итог».
- [ ] Живой сон на одном Mac: dev-сборка и Stable copy связаны, `pmset sleepnow`. После пробуждения в выводе main получателя есть строка о принятом «засыпаю», и её время — до сна. На одном Mac обе копии засыпают вместе, поэтому это проверяет только, что `suspend` приходит раньше заморозки процесса. Проверка по сети между двумя машинами — в Ticket-е 16, на паре Mac + Windows.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all gate.sh full` — зелёный.

## Тесты

Сначала падающий test — `test/unit/link-power.test.ts`: подключение Linked machine не запускает blocker. В «Итог» — как test падал.

`powerMonitor` в e2e — настоящий модуль Electron. `emit('suspend')` вызывает подписчиков worfy, но машину не усыпляет. Поэтому e2e проверяет реакцию worfy, а не сам сон. Живой сон — отдельный пункт «Готово, когда».

Строка в логе о принятом «засыпаю» называет Machine и время. Ни токена, ни адреса соединения в ней нет.

Helper двух связанных worfy берётся из Ticket-а 02 как есть. `test/e2e/helpers.ts` этот Ticket не правит.

## Где в коде

- `src/main/autopilot/power.ts`
- `src/main/link/keep-awake.ts` (новый)
- `src/main/link/sleep-notice.ts` (новый)
- `src/shared/ipc/link.ts`
- `test/unit/link-power.test.ts` (новый)
- `test/e2e/linked-sleep.spec.ts` (новый)

Файлы Ticket-а 02, дописанные при claim:

- `src/main/link/settings.ts` — новый переключатель рядом с переключателем доступа
- `src/main/link/service.ts` — `wireAppLink`, `stopLink`, `startAppLink`: сборка «засыпаю» и blocker-а связи
- `src/main/ipc/link.ts` — состояние «sleeping» в `link.state`, канал `link.setKeepAwake`
- `src/renderer/machines/useMachines.ts`, `src/renderer/shell/sidebar/MachinesSection.tsx` — переключатель и chip «Sleeping»
- `test/contract/link-connections.test.ts` — ожидания значения настроек: в нём теперь и `keepAwake`

## Итог

Сделано в ветке `worfy-link/14`.

- **Первый test падал так.** `test/unit/link-power.test.ts` против заготовок `keep-awake.ts` и `sleep-notice.ts`
  (класс без подписок): `12 failed | 5 passed`. Первый test — `expected false to be true` на `awake.held` после
  подключения Linked machine: подключение blocker не запускало. Test-ы «засыпаю» — `expected 'online' to be 'sleeping'`
  (таймаут ожидания 5 s). До заготовок файл не загружался: `Cannot find module '/src/main/link/keep-awake'`.
- **Blocker связи** — `src/main/link/keep-awake.ts`, `LinkKeepAwake`. Один `KeepAwake` (`src/main/autopilot/power.ts`) типа
  `prevent-app-suspension`. Условия перечитываются на событиях сервиса `connected`, `disconnected`, `unlinked`,
  `settings`: blocker снимается в том же ходе, в котором условие перестало выполняться. «Подключена» — открыто хоть одно
  соединение, кто бы его ни открыл (`LinkedMachineInfo.connected`). `will-quit` снимает blocker через `KeepAwake`;
  `stopLink` снимает его и отписывается.
- **`KeepAwake` с типом в параметре:** `new KeepAwake(deps, type)`, по умолчанию `prevent-display-sleep`. Autopilot не
  менялся, `test/unit/autopilot-power.test.ts` зелёный без правок.
- **Переключатель** «Keep this computer awake while linked machines are connected» — `link/settings.json`, поле
  `keepAwake` рядом с `projectsAccess`, та же `version: 1`. Нет поля (файл Ticket-а 02) или нет файла — включён. Канал
  `link.setKeepAwake` — пометка `local`, как `link.setAccess`; в состоянии `link.state` — поле `keepAwake`. В UI — второй
  переключатель под переключателем доступа, `data-testid="link-keep-awake-switch"`.
- **«Засыпаю»** — `src/main/link/sleep-notice.ts`, `SleepNotice`: служебные сообщения связи `sleeping` и `awake`
  (регистрируются на сервисе, как велит `messages.ts`). На `powerMonitor` `suspend` — `sleeping` всем подключённым Linked
  machine-ам, на `resume` — `awake` тем, с кем соединение открыто. Получатель держит пометку «спит», пока не откроется
  новое соединение (событие `connected`, любое направление) или не придёт `awake`; отзыв снимает её вместе с записью.
- **Третье состояние** — `sleeping` в `linkedMachineViewSchema.state` (`src/shared/ipc/link.ts`). В строке Machines —
  нейтральный chip «Sleeping», как у «Unavailable», `data-state="sleeping"`. «спит» показывается и пока старое соединение
  ещё не оборвалось: сообщение пришло раньше обрыва. Ticket 09 (группы Project-ов) к моменту этой ветки не влит —
  третье значение он берёт сам.
- **Строка лога получателя:** `[link] Machine <id> (<имя>) is going to sleep (<время ISO>)` — `console.log` main. Ни
  токена, ни адреса (test проверяет `leakedSecrets` и отсутствие `127.0.0.1`). Отправитель пишет
  `[link] this Machine is going to sleep; told N Linked machines (<время>)`.
- **Assertion настоящего Electron** (e2e-пара dev-сборок из `out/`, не Stable copy; временный spec в своём worktree,
  удалён): доступ включён только у A — `pmset -g assertions` показывает у pid A
  `NoIdleSleepAssertion named: "Electron"` (это и есть `PreventUserIdleSystemSleep`), у pid B — ничего. Новый
  переключатель выключен — у A ничего; включён снова — assertion вернулся; B отозвана на A — ничего; после выхода обеих —
  ничего. После всех прогонов e2e в `pmset -g assertions` нет ни одного процесса test-ов.

Решения (все — **решено без владельца, подтвердить**):

- Условие «включён доступ» для blocker-а — как в «Что делаем», п. 1 (определение Ticket-а, подтверждение при claim не
  получено: владелец не на связи).
- «спит» побеждает открытое соединение: сообщение `sleeping` приходит раньше обрыва, и e2e (сон без настоящего сна)
  держит соединение открытым. Снимает «спит» только новое соединение или `awake`.
- Пока сервис связи не запустился, `link.state` отдаёт `keepAwake: false` (как `projectsAccess: false`); переключатели в
  это время недоступны.
- Новое поле в `settings.json` без смены `version`: старая сборка прочтёт файл (лишнее поле zod отбрасывает) и при своей
  записи его потеряет — переключатель вернётся к «включён».

Проверки: `pnpm lint`, `pnpm typecheck` — exit 0; `test/unit/link-power.test.ts` — 17 passed;
`test/e2e/linked-sleep.spec.ts` и `test/e2e/linked-machines.spec.ts` — 7 passed; `GATE_SCOPE=all gate.sh full` — lint,
typecheck, test:e2e, test:package прошли, `test` красный только таймаутами (5000 ms) `test/contract/github-prs.test.ts`
под нагрузкой машины (load average 5–7, рядом идут другие агенты). Полный `pnpm test` в эти же минуты — 21 таймаут в
семи файлах `test/contract/` (`github-prs`, `harness-evals`, `harness-install`, `harness-migrate`, `harness-qmd`,
`workflow-profile`, `workflow-reader`), ни одного в файлах связи; те же семь файлов на чистом `origin/main` (27f12f6) в
отдельном worktree — 20 failed, тоже таймауты. Unit и contract test-ы на Linux — CI PR-а.
Mutation-проверка в своём worktree (вернул из копии), test-ы `link-power.test.ts` краснеют на всех семи: без условия
доступа; без подписки на `unlinked` (blocker держится после отзыва); перезапуск blocker-а на каждом событии; «спит» не
снимается новым соединением; «спит» только после обрыва; «спит» не снимается отзывом; `stop()` не отписывается от
`suspend`.

- не проверено: «Команда на Mac» с Stable copy — бриф запрещает запускать и пересобирать Stable copy. Вместо неё —
  пара dev-сборок из e2e (выше).
- не проверено: «Живой сон на одном Mac» (`pmset sleepnow`) — бриф запрещает усыплять Mac владельца. Успевает ли
  `sleeping` уйти до заморозки процесса на macOS, не известно; не успеет — вторая машина покажет «недоступна», как без
  этого Ticket-а. Проверка — шагом владельца или в Ticket-е 16.
