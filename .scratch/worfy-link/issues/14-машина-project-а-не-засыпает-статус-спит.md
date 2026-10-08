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

- [ ] Unit `test/unit/link-power.test.ts` (новый, `PowerDeps` подменены, как в `test/unit/autopilot-power.test.ts`). Первая подключённая Linked machine запускает один blocker типа `prevent-app-suspension`, вторая не запускает второй. Blocker снимается сразу: при отключении последней Linked machine, её отзыве, выключении переключателя доступа и нового переключателя. При выключенном новом переключателе подключение blocker не запускает. `will-quit` снимает blocker.
- [ ] Unit там же: прогон Autopilot и связь держат каждый свой blocker. Конец прогона не снимает blocker связи, и наоборот. `test/unit/autopilot-power.test.ts` зелёный без правок.
- [ ] Unit там же, две Machine в одном процессе vitest (стенд Ticket-а 01). `suspend` на A — B видит у A «спит». Разрыв соединения после этого «спит» не меняет. Разрыв без сообщения — «недоступна». Новое соединение — «в сети».
- [ ] e2e `test/e2e/linked-sleep.spec.ts` (новый, локально в gate full): два worfy, связанные helper-ом Ticket-а 02. `powerMonitor.emit('suspend')` в main A через `app.evaluate` — в списке Linked machine-ов B у A состояние «спит» (по `data-testid`). `emit('resume')` — снова «в сети». Новый переключатель виден в UI и по умолчанию включён; выключенный, он остаётся выключенным после перезапуска.
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

При claim сюда дописываются файлы Ticket-а 02: состояние Linked machine-ов, их список в UI и хранение переключателя доступа. Их пути будут в «Итог» Ticket-а 02.

## Итог

Заполняется при закрытии.
