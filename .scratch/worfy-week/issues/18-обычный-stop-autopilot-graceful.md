# 18 — Обычный Stop в Autopilot — graceful: новых Ticket-ов не брать; Force stop — в меню «⋯»

Type: task
Status: done 2026-10-07
PR: #129
Blocked by: 17
Source: ответ владельца 2026-10-07 на решения по умолчанию Ticket-а [17](17-stop-в-autopilot-прерывает-orchestrator.md) («17 верно, но давай обычный стоп автопилота сделаем graceful, т.е не брать новые тикеты, и на карточке в троеточие спрятать пункт force stop»); [ADR-0029](../../../docs/adr/0029-autopilot-waits-for-background-tasks.md), пункты 5–6; [spec.md](../spec.md), этап 3

## Что происходит

Ticket 17 делает из Stop одно действие — «прервать всё». `Session.halt()` прерывает ход
Orchestrator-а, вместе с ходом умирают его Background task-и, `giveBackNow` сразу возвращает
Orchestrator-а человеку. Причина — `user-stop`; `run-stopped` несёт Ticket-ы прерванной Wave, и
повторный старт берёт их первыми (`resumable`). Владелец с этим согласен, но как с крайней мерой.
Обычный Stop должен быть мягким (graceful): новых Ticket-ов не брать, взятые довести до конца.

Строки ниже — по main 24e232c, до Ticket-а 17. Что меняет 17 — по его «Что делаем».

- Мягкой остановки нет ни до 17, ни после.
  - До 17 Stop останавливает прогон сразу (`src/shared/autopilot/cycle.ts:165-166`) и держит
    Orchestrator-а unattended, пока живы Background task-и (ADR-0029, пункт 5,
    `docs/adr/0029-autopilot-waits-for-background-tasks.md:59-70`). Orchestrator об остановке не
    знает: task-notification начинает новый ход, и `/epic-wave` идёт дальше — до merge и до запуска
    Ticket-ов Wave, которые ещё не запущены.
  - После 17 Stop обрывает всё, в том числе implementer-а посреди merge.
- Состояния «останавливается» у прогона нет: `status` — `running`, `waiting` или `stopped`
  (`src/shared/ipc/autopilot.ts:21`). `autopilot.stop` отвечает только после конца прогона
  (`src/shared/ipc/autopilot.ts:43-44`, `src/main/autopilot/run.ts:312-318`).
- Писать Orchestrator-у от имени прогона worfy уже умеет: после сброса Limits прогон шлёт
  `CONTINUE_TEXT` (`src/main/autopilot/limits-wait.ts:24-25`) через `send` Session (`run.ts:548`).
  Сообщение, посланное во время хода, ждёт в очереди Session и уходит после `result`, по одному на
  ход (`src/main/agent/session.ts:17-18`, `:352-357`).
- ADR-0029, пункт 6 (`:71-73`), отказался от кнопки «остановить и убить задачи»: это решение о
  судьбе чужой работы, например implementer-а посреди merge. Ticket 17 такую кнопку вводит и делает
  её единственным Stop.
- Меню «⋯» у рамки Epic-а нет. В заголовке рамки — кнопки действий
  (`src/renderer/canvas/nodes/EpicFrameNode.tsx:66-68`) и шеврон сворачивания (`:69-77`).
- HTML-меню в worfy есть, по ним и строится новое:
  - контекстное меню Canvas (`src/renderer/canvas/overlays/CanvasMenu.tsx:91-126`): portal в
    `document.body`, `role="menu"`, фокус на первом пункте, стрелки; Esc, клик вне меню и blur окна
    закрывают; стиль — `menuStyle` (`:23-32`);
  - меню строки Project (`src/renderer/shell/sidebar/ProjectsSection.tsx:58-105`).
- Слот действий считает действием каждый `.tsx` в `src/renderer/canvas/actions/`
  (`src/renderer/canvas/badges/index.ts:44`). Поэтому вспомогательный код там пишут без JSX
  (`src/renderer/canvas/actions/action-button.ts:1-3`).

## Что делаем

Два действия вместо одного: **Stop** (кнопка «Stop autopilot») — graceful; **Force stop** (пункт
меню «⋯») — то, что делает Stop Ticket-а 17.

1. **Причины.** В `AUTOPILOT_STOP_REASONS` (`src/shared/autopilot/cycle.ts`) — новая
   `user-force-stop`. `user-stop` теперь значит graceful Stop. `user-force-stop` получает всё, что
   Ticket 17 делает для `user-stop`: ветку `end()` с `halt` и `giveBackNow`, `tasks-killed` с этой
   причиной, `tickets` прерванной Wave в `run-stopped`. Строка состояния — `stopped: user force stop`.
2. **Cycle.** Новое событие `graceful-stop`, в `CycleState` — флаг `stopping` и список `inWork`,
   новый эффект `stopping`.
   - `starting` — стоп сразу с `user-stop`: Wave ещё не ушла.
   - `sending` — флаг ставится, решение — когда «Run wave» ответил: дальше как в `turn`.
   - `turn` и `tasks` — флаг `stopping` и эффект `stopping`; фаза не меняется.
   - Если ход Wave ещё не начался и «Run wave» лежит в очереди Session (`run.waveTurn === null`),
     прогон убирает Wave из очереди (`dropQueuedWave`, `src/main/autopilot/run.ts:569-578`) и
     останавливается с `user-stop`: Ticket-ов никто не брал.
   - `settling` (ход кончился, Background task-ов нет, Ticket-ы Wave ещё в `work`) — стоп сразу с
     `user-stop`: Orchestrator уже вернул ход.
   - Пока `stopping`, `evaluate` не шлёт новую Wave и не ждёт файлов Ticket-ов. Ход кончился без
     ошибки, Session `idle`, Background task-ов 0 — стоп с `user-stop`. `wave-finished` не пишется:
     незапущенные Ticket-ы Wave остались `open`.
   - `BACKGROUND_STALL_MS` (`background-stalled`), `TASKS_GRACE_MS`, ошибки Session и хода,
     `interrupted` и `app-quit` действуют как раньше.
   - `stop` с `user-force-stop` действует в любой фазе, в том числе при `stopping`.
   - `inWork` — Ticket-ы текущей Wave в `work` по последнему чтению workflow. Пока `stopping`, он
     пересчитывается на каждом `workflow`, `turn-ended` и `tasks-timeout`.
3. **Сообщение Orchestrator-у.** На эффект `stopping` прогон пишет `run-stopping` и шлёт
   Orchestrator-у `STOP_TEXT` через `send` Session (в `RunSession`, `run.ts:60-67`, — метод `send`).
   Константа — по образцу `CONTINUE_TEXT`, по-русски: «Autopilot остановлен человеком. Новые
   Ticket-ы не бери и новые Wave-ы не начинай. Ticket-ы текущей Wave, которые ещё не запущены, не
   запускай. Ticket-ы, уже взятые в работу, доведи до конца как обычно — merge или blocked, — потом
   закончи ход.»
   - Идёт ход — текст ложится в очередь и уходит после его `result`. Ticket-ы, которые этот ход
     успел запустить, считаются взятыми и доводятся.
   - Orchestrator idle (фаза `tasks`) — текст уходит сразу и начинает ход.
   - Прогон ждёт Limits (`waiting`) — сейчас текст не шлётся: Session откажет любому ходу. Он уходит
     после сброса вместе с продолжением, одним сообщением: `CONTINUE_TEXT`, затем `STOP_TEXT`.
   - Это не протокол со skill-ом (ADR-0002): прогон не проверяет, послушался ли Orchestrator. Конец
     прогона решают события Session.
   - Это не `human-input`: текст шлёт worfy, а не человек через UI (`noteInput` не зовётся).
4. **Main.** `Autopilot.stop` — graceful: подаёт `graceful-stop` и отвечает, как только прогон в
   `stopping` или уже `stopped`, не дожидаясь конца. Новый `Autopilot.forceStop` — путь Ticket-а 17
   с `user-force-stop`, отвечает после конца прогона. Канал `autopilot.forceStop` — в
   `src/shared/ipc/autopilot.ts`, handler — в `src/main/ipc/autopilot.ts`.
   - Повторный Stop при `stopping` ничего не шлёт и отвечает состоянием.
   - Новый старт при `stopping` отклоняется: прогон ещё идёт (`alreadyRunning`).
   - `app-quit` при `stopping` — как у обычного прогона (ADR-0029, пункт 7).
5. **Состояние.** `AutopilotState` получает `stopping: boolean` и `ticketsInWork: number` — длину
   `inWork`, 0 без `stopping`. `status` прежний: `stopping` — флаг поверх `running` и `waiting`.
   Keep-awake держится до конца прогона (ADR-0034). После `user-stop` linger не нужен: прогон
   кончается, когда хода и Background task-ов уже нет. Страховка `end()` (`run.ts:645-646`) остаётся.
6. **Повторный старт.** `resumable` (Ticket 17, пункт 5) непуст только после Force stop. В ветке
   `worfy-week/17` (cd0a01b) список берётся не из журнала, а из последнего прогона Project-а в
   памяти main: `this.last` и `run.interrupted` в `src/main/autopilot/run.ts`, условие
   `run.cycle.reason === 'user-stop'`. Условие становится `user-force-stop`.
   - Graceful `run-stopped` поле `tickets` не пишет, `run.interrupted` не заполняет.
   - Ticket, оставшийся в `work` после graceful Stop, повторный старт не берёт: его ведёт человек.
   - Состояние в памяти не переживает перезапуск приложения, а 18 приходит новой сборкой. Поэтому
     строки журнала, записанные между влитием 17 и 18, переводить не нужно. Если влитый 17 берёт
     список иначе (например из журнала), правило то же — только после `user-force-stop`, — а
     «Итог» говорит, как оно сделано.
7. **Журнал** (`src/shared/autopilot/journal.ts`, шапка и схема).
   - Новый kind `run-stopping`: `reason` (`user-stop`), `wave` и `tickets` (как в `wave-started`),
     `inWork` — Ticket-ы Wave в `work` в момент Stop.
   - Шапка: `run-stopped` с `user-force-stop` несёт `tickets` прерванной Wave; `tasks-killed` —
     причины `app-quit` и `user-force-stop`.
   - Graceful: `run-stopping` → `background-tasks` … → `run-stopped` (`user-stop`).
   - Force stop во время graceful: `run-stopping` → … → `run-stopped` (`user-force-stop`, `tickets`)
     → `tasks-killed` (`user-force-stop`), если Background task-и были живы →
     `orchestrator-returned`.
8. **UI** (`src/renderer/canvas/actions/AutopilotAction.tsx`).
   - «Stop autopilot» — graceful. Title — «Stop Autopilot over <epic>: takes no new Tickets; the
     Tickets in work finish (merge or blocked)».
   - Пока `stopping`, та же кнопка — «Stopping…», неактивна (`aria-disabled="true"`). Title —
     «Autopilot over <epic> is stopping: no new Tickets; it waits for the Tickets in work. Force stop
     is under ⋯». Пока `autopilot.forceStop` не вернулся — тоже «Stopping…», как у Stop Ticket-а 17.
   - Строка состояния при `stopping` и `running`: `stopping · 2 tickets in work`,
     `stopping · 1 ticket in work`; `stopping`, когда Ticket-ов Wave в `work` нет (ждём ход
     Orchestrator-а или его Background task-и). При `waiting` — прежняя строка Limits. Текст строит
     `autopilotStatusLine` (`src/shared/ipc/autopilot.ts`).
   - Справа от Stop — кнопка «⋯», пока прогон этого Epic-а `running` или `waiting`, в том числе при
     `stopping`. Вид — общая кнопка действия `.w-action` квадратом 20×20 с текстом «⋯».
     `aria-label` — «More Autopilot actions for <epic>», `aria-haspopup="menu"`, `aria-expanded`,
     title «More Autopilot actions», `data-testid="action-autopilot-more"`.
   - Меню: `role="menu"`, `aria-label` «Autopilot over <epic>», один пункт «Force stop»
     (`role="menuitem"`, `data-testid="action-force-stop-autopilot"`). Title пункта — «Stop
     Autopilot over <epic> now: interrupts the Orchestrator and its background tasks; worktrees stay.
     The next Autopilot takes the interrupted Tickets first». Пока `autopilot.forceStop` в пути, пункт
     `aria-disabled="true"`. Отказ main — его причина в title «⋯» и рамка цвета blocked, как у
     `ActionButton`.
   - Поведение — как у меню Canvas. Portal в `document.body`, `position: fixed` под «⋯» по правому
     краю: иначе zoom Canvas масштабирует меню, а рамка его обрежет. Фокус — на первом пункте,
     стрелки ходят по пунктам. Закрывают Esc, клик вне меню, blur окна, wheel вне меню и выбор
     пункта; после закрытия фокус — на «⋯».
   - Esc в меню зовёт `preventDefault`: одно нажатие — одно действие (правило Ticket-а 15). Охрана
     Esc Ticket-а 15 видит открытый `[role="menu"]` и стопку done не сворачивает.
   - Код кнопки и меню — новый `src/renderer/canvas/actions/action-menu.ts`, без JSX, как
     `action-button.ts`: любой `.tsx` этой папки слот считает действием.
   - Стили — в `src/renderer/canvas/actions/actions.css`: модификатор кнопки-иконки и класс меню на
     токенах `menuStyle` меню Canvas. `.w-action` не меняется: иначе изменится вид «Run wave» и
     «Ship ticket».
   - На рамке другого Epic-а, пока прогон этого Project-а `stopping`: «Autopilot» неактивна, title —
     «Autopilot is stopping Epic <epic>».
   - Комментарий в начале `AutopilotAction.tsx` — о двух действиях.
9. **F-SPEC**, раздел «Autopilot (Epic frame)» (`docs/design/F-SPEC.md:42-66`).
   - Labels: «Stopping…» и когда она видна.
   - Новый пункт «More menu (⋯)»: место, вид, aria-label, меню, пункт Force stop, закрытие, фокус.
   - Tooltips: Stop, «Stopping…», «⋯», Force stop.
   - Status line text: `stopping · N tickets in work`, `stopping`, `stopped: user force stop`.
   - Список снимков: `autopilot-stopping`.
10. **Новый ADR** (номер выдаёт Orchestrator): обычный Stop — graceful, Force stop — в меню «⋯».
    Ссылки — на ADR-0029 и на ADR Ticket-а 17 (в ветке `worfy-week/17` это ADR-0050; номер
    сверить с «Итог» Ticket-а 17). Оба не правятся.
    - Для Stop заменяет решение ADR Ticket-а 17. Прерывание остаётся, но только как Force stop
      (`user-force-stop`).
    - Graceful Stop — в духе ADR-0029: implementer-а не бросают посреди merge. Отличие от пункта 5
      ADR-0029: прогон не кончается сразу, а идёт в состоянии `stopping` и говорит Orchestrator-у не
      брать новых Ticket-ов.
    - Ответ на пункт 6 ADR-0029: «остановить и убить задачи» — теперь явное решение человека, за
      лишним кликом в меню.
    - Граница: ход, который идёт в момент Stop, доходит до конца, и Ticket-ы, запущенные им,
      доводятся. Сообщение — не протокол (ADR-0002).
    - Stop во время ожидания Limits ждёт сброса; Force stop — сразу.
    - Прерванные Ticket-ы повторный старт берёт только после Force stop.
    - Отвергнуто: Stop = Force stop с диалогом подтверждения; graceful без сообщения Orchestrator-у
      (`/epic-wave` в ходе от task-notification запустил бы незапущенные Ticket-ы Wave); graceful
      через interrupt хода и новое сообщение (обрывает шаг, который идёт); кнопка Force stop рядом со
      Stop (владелец просил меню).

**Решено без владельца, подтверждено владельцем 2026-10-12:**

- Имена причин: `user-stop` — graceful Stop, `user-force-stop` — Force stop.
- Stop во время ожидания Limits не останавливает прогон сразу: ждёт сброса и шлёт `STOP_TEXT`
  вместе с продолжением. Иначе Ticket-ы в работе повисли бы. Кому нужно сразу — Force stop.
- Stop в `settling` останавливает прогон сразу: Orchestrator idle, Background task-ов нет.
- Строка считает Ticket-ы текущей Wave в `work`, а не Background task-и.
- «⋯» виден только пока прогон этого Epic-а идёт. У остановленного прогона меню нет: Force stop
  нечего прерывать.

Известный риск: graceful Stop длится, пока идут Ticket-ы в работе, — до часа и дольше (implementer
ждёт CI). Ограничивает его только `BACKGROUND_STALL_MS`, который считается от последнего события
Background task-ов. Кому нужен Mac сейчас — Force stop.

## Готово, когда

- [x] Unit `test/unit/autopilot-cycle.test.ts`: `graceful-stop` в `starting` — `stopped` с `user-stop`; в `sending` — эффектов нет, а `wave-sent` после него даёт `wave-started` и `stopping`; в `turn` и `tasks` — эффект `stopping`, фаза прежняя; следующий `turn-ended` (idle, 0 Background task-ов) — `stopped` с `user-stop` без `wave-finished` и `send-wave`, даже когда готова следующая Wave; в `settling` — `stopped` с `user-stop` сразу; `stop` с `user-force-stop` при `stopping` — `stopped` с `user-force-stop` и Ticket-ами Wave; событие `workflow` при `stopping` пересчитывает `inWork`.
- [x] Unit `test/unit/autopilot-run.test.ts`: Stop в фазе `turn` шлёт `STOP_TEXT` один раз и не вызывает `halt`; `stop()` возвращается с `stopping: true` до конца хода; журнал по порядку — `run-stopping` (`user-stop`, `wave`, `tickets`, `inWork`), `run-stopped` (`user-stop`, без `tickets`). Force stop при `stopping` вызывает `halt` и `giveBackNow` по одному разу; журнал — `run-stopping`, `run-stopped` (`user-force-stop`, `tickets`), `tasks-killed` (`user-force-stop`), `orchestrator-returned`. Сценарии Ticket-а 17 с `user-stop` переведены на `forceStop` и `user-force-stop`.
- [x] Unit там же: Stop, пока «Run wave» лежит в очереди Session (ход Wave не начался), убирает его из очереди (`removeQueued`) и кончает прогон с `user-stop`; `STOP_TEXT` не уходит.
- [x] Unit там же: после Force stop `resumable` — Ticket-ы прерванной Wave, которые всё ещё в `work`; после graceful Stop — пустой, даже когда Ticket Wave остался в `work`.
- [x] Contract `test/contract/autopilot-background.test.ts`: Stop в фазе `tasks` — Orchestrator unattended, пока последний Background task не кончился и ход от его task-notification не вернул `result`; нового «Run wave» нет; `STOP_TEXT` ушёл в Session один раз; потом `isUnattended(PROJECT)` false, power `['start', 'stop']`. Сценарии Stop Ticket-а 17 идут через `forceStop`.
- [x] Contract `test/contract/autopilot.test.ts`: `autopilot.forceStop` по IPC; `autopilot.stop` при `stopping` отвечает состоянием без второго `STOP_TEXT`; старт при `stopping` отклонён; Stop в `starting` — `stopped` с `user-stop` сразу.
- [x] Contract `test/contract/autopilot-limits.test.ts`: test «Stop during the wait cancels the timer: no continuation goes out» (main `:336`) переписан — Stop во время ожидания Limits оставляет `waiting` и `stopping: true`; после сброса Orchestrator получает одно сообщение — продолжение и `STOP_TEXT`. Новый test: Force stop во время ожидания — `stopped` с `user-force-stop`, ожидание снято, продолжение не уходит.
- [x] Contract `test/contract/autopilot-journal.test.ts`: строка `run-stopping` проходит схему; строка `run-stopping` без `inWork` пропускается и считается.
- [x] Unit `test/unit/canvas-actions.test.tsx`: при `stopping` кнопка «Stopping…» с `aria-disabled="true"` и строка `stopping · 2 tickets in work`; «⋯» есть при `running`, `waiting` и `stopping`, нет при `stopped`; клик по «⋯» открывает меню, фокус на «Force stop»; Esc закрывает меню с `defaultPrevented`, фокус на «⋯»; клик по пункту зовёт `autopilot.forceStop`; на рамке другого Epic-а при `stopping` «Autopilot» неактивна, title «Autopilot is stopping Epic <epic>». `autopilotStatusLine` даёт `stopping · 1 ticket in work`, `stopping`, `stopped: user force stop`.
- [x] e2e `test/e2e/autopilot.spec.ts` (локально, в gate full; строки — по main, после 17 они сдвинутся). Test «Autopilot on an Epic: … stops on Stop» (`:217`) — после Stop кнопка «Stopping…», строка `stopping`, Orchestrator получил `STOP_TEXT`; после конца хода — `stopped: user stop`, журнал `['run-started', 'wave-started 1', 'run-stopping', 'run-stopped user-stop']`, power `['start prevent-display-sleep', 'stop']`; снимок `autopilot-stopping` в светлой и тёмной теме. Test «Autopilot waits for the Limits after a refusal …» (`:288`) — под новое поведение Stop во время Limits. Test-ы Stop, которые переписал или добавил Ticket 17 («Autopilot waits for the background tasks of the Wave; Stop kills them …» и «Stop during the Wave's turn: …» в ветке `worfy-week/17`), жмут «⋯» → «Force stop».
- [x] `grep -n "Force stop" docs/design/F-SPEC.md src/renderer/canvas/actions/AutopilotAction.tsx` и `grep -n "interrupts the Orchestrator"` по тем же файлам находят строки в обоих.
- [x] ADR записан.
- [x] `~/.claude/hooks/gate.sh fast` — exit 0, строка `[gate]` говорит green.
- [ ] (вручную) Stable copy после влития: Autopilot над Wave с implementer-ом, Stop — строка `stopping · 1 ticket in work`, новых implementer-ов Orchestrator не запускает, implementer доходит до merge или blocked, прогон кончается `stopped: user stop`. Снова Autopilot, «⋯» → «Force stop» — за 15 s процесса implementer-а нет (`ps`), повторный Autopilot берёт прерванный Ticket первым. Как проверить: окно приложения и журнал `~/Library/Application Support/worfy/autopilot/`.

## Тесты

Сначала падающие test-ы — `test/unit/autopilot-cycle.test.ts` (события `graceful-stop` нет) и
`test/contract/autopilot-background.test.ts` (после Stop Orchestrator прерван, `STOP_TEXT` не
уходит). В «Итог» — как падали.

- `test/unit/autopilot-cycle.test.ts` — `graceful-stop`, `stopping`, `inWork`, `user-force-stop`.
- `test/unit/autopilot-run.test.ts` — Stop и Force stop, порядок журнала, `resumable`.
- `test/contract/autopilot-background.test.ts`, `test/contract/autopilot.test.ts` — graceful Stop
  с живыми Background task-ами, IPC; сценарии Ticket-а 17 — через `forceStop`.
- `test/contract/autopilot-limits.test.ts` — Stop и Force stop во время ожидания Limits.
- `test/contract/autopilot-journal.test.ts` — `run-stopping`.
- `test/unit/canvas-actions.test.tsx` — «Stopping…», «⋯», меню, строка состояния.
- `test/e2e/autopilot.spec.ts` — Stop, Stop во время Limits, test-ы Stop Ticket-а 17 через
  Force stop, снимок `autopilot-stopping`.

## Где в коде

- `src/shared/autopilot/cycle.ts`
- `src/shared/autopilot/journal.ts`
- `src/shared/ipc/autopilot.ts`
- `src/main/autopilot/run.ts`
- `src/main/ipc/autopilot.ts`
- `src/renderer/canvas/actions/AutopilotAction.tsx`
- `src/renderer/canvas/actions/action-menu.ts` — новый
- `src/renderer/canvas/actions/actions.css`
- `docs/design/F-SPEC.md`
- `test/unit/autopilot-cycle.test.ts`
- `test/unit/autopilot-run.test.ts`
- `test/contract/autopilot-background.test.ts`
- `test/contract/autopilot.test.ts`
- `test/contract/autopilot-limits.test.ts`
- `test/contract/autopilot-journal.test.ts`
- `test/unit/canvas-actions.test.tsx`
- `test/e2e/autopilot.spec.ts`

Список — по состоянию после Ticket-а 17: он вводит `halt`, `giveBackNow`, `resumable` и «Stopping…»
в те же файлы. Правило `resumable` по плану 17 живёт в `src/main/autopilot/run.ts`. Если 17 вынес
его в другой файл, правка идёт туда, и «Итог» называет этот файл. Не меняются:
`src/main/agent/session.ts` и `src/main/agent/orchestrator.ts` (`halt` и `giveBackNow` Ticket-а 17
берутся как есть, `send` у Session уже есть); `src/main/actions/launch.ts`,
`src/shared/actions/render-template.ts` и `src/renderer/canvas/actions/gates.ts` (берут `resumable`
готовым); `src/main/autopilot/limits-wait.ts` (продолжение и `STOP_TEXT` склеивает `run.ts`). Новый
ADR — файл в `docs/adr`, номер выдаёт Orchestrator. Общие файлы: с 17 — почти все, поэтому
`Blocked by: 17`; с 15 — `F-SPEC.md`, поэтому 18 идёт Wave-ой позже 15. С 13, 14 и 16 общих файлов
нет.

## Итог

Ветка `worfy-week/18`, решение — [ADR-0051](../../../docs/adr/0051-autopilot-graceful-stop-force-stop-in-menu.md)
(ссылается на ADR-0029 и ADR-0050, оба не правлены).

**Влито.** [PR #129](https://github.com/IDSAD-XL/worfy/pull/129), merge 4473a9e. Ревью — REJECTED в
первом круге, VERIFIED после одного круга доработки. Первый круг нашёл гонку: мягкий Stop, нажатый,
пока его шаг ждал очереди прогона, не мешал прогону отправить следующую Wave. Исправлено синхронным
флагом `stopRequested` на прогоне (абзац «Круг доработки» ниже). Решение — ADR-0051.

- **Как падали test-ы до правки.** `test/unit/autopilot-cycle.test.ts` — 12 из 35 красных: события
  `graceful-stop` нет, у `initialCycle` нет `stopping` и `inWork`, `stop` с `user-stop` нёс
  Ticket-ы. Contract «a graceful Stop with live tasks …» (`test/contract/autopilot-background.test.ts`)
  проверен на мутанте «Stop идёт путём Force stop»: красный (Orchestrator прерван, `STOP_TEXT` не
  ушёл).
- **Cycle** (`src/shared/autopilot/cycle.ts`): событие `graceful-stop` (с Ticket-ами свежего
  чтения), флаг `stopping`, список `inWork`, эффект `stopping`; причина `user-force-stop`.
- **Main** (`src/main/autopilot/run.ts`): `stop()` — graceful, `forceStop()` — путь Ticket-а 17;
  `STOP_TEXT` — константа там же; в `RunSession` добавлен `send`. Правило `resumable` осталось в
  `run.ts` (`this.last`, `run.interrupted`), условие — `user-force-stop`. При конце прогона из
  очереди Session убирается и Wave, и ещё не ушедший `STOP_TEXT` (иначе Force stop во время
  graceful Stop отдал бы `STOP_TEXT` в очередь Session человека).
- **Круг доработки (гейт)**: клик по Stop отмечается на прогоне сразу (`stopRequested`), до того как
  его шаг дождётся очереди прогона. `sendWave` с этим флагом Wave не шлёт и кончает прогон с
  `user-stop`. Если «Run wave» уже в пути, cycle получает `graceful-stop` в фазе `sending`, и Wave
  уходит в состоянии stopping. Продолжение после Limits несёт `STOP_TEXT` и тогда, когда шаг Stop
  ещё ждёт. Test-ы — `test/unit/autopilot-run.test.ts`, describe «the click on Stop is noted at
  once», и Limits-test «a Stop clicked as the wait ends …».
- **UI**: «⋯» и меню — `src/renderer/canvas/actions/action-menu.ts` (без JSX), стили —
  `actions.css` (`.w-action--icon`, `.w-action-menu`).
- **Test вне следа** (разрешён брифом): `test/contract/agent-controls.test.ts` — «Send queued» на
  halted Session ничего не шлёт в процесс; краснеет без проверки `halted` в `Session.next()`.
- **Снимки** (e2e `test/e2e/autopilot.spec.ts`, fake-агент):
  - меню «⋯»: [светлая](../evidence/18-autopilot-menu-light.png), [тёмная](../evidence/18-autopilot-menu-dark.png);
  - «Stopping…» и строка `stopping`: [светлая](../evidence/18-autopilot-stopping-light.png), [тёмная](../evidence/18-autopilot-stopping-dark.png);
  - Stop во время ожидания Limits: [светлая](../evidence/18-autopilot-waiting-stopping-light.png), [тёмная](../evidence/18-autopilot-waiting-stopping-dark.png);
  - меню при Force stop в пути, пункт неактивен: [светлая](../evidence/18-force-stop-pending-menu-light.png), [тёмная](../evidence/18-force-stop-pending-menu-dark.png).
- **Решено без владельца, подтверждено владельцем 2026-10-12** — пять пунктов раздела «Что делаем» приняты как
  рекомендовано: имена причин; Stop во время Limits ждёт сброса; Stop в `settling` — сразу; строка
  считает Ticket-ы Wave, а не Background task-и; «⋯» только у идущего прогона. Ещё одно: в
  журнальном test-е e2e строка `run-stopping` записана как `run-stopping 1` (помощник
  `journalKinds` добавляет номер Wave).
- **Не проверено**: ручная проверка stable copy после влития (пункт «вручную» выше) — за
  владельцем.

**Долг** (из комментариев в PR #129).

- `src/main/autopilot/run.ts:623` — ветка «Stop нажат, пока „Run wave“ в пути»: cycle получает
  `graceful-stop` в фазе `sending`, когда ответ на «Run wave» пришёл. Строка не покрыта test-ом.
- Force stop сразу после мягкого Stop, пока идёт ход человека, кончается как `user-stop` без `halt`.
  Так было и до круга доработки.
- Закрыт долг Ticket-а 17: проверка `if (this.halted) return` в `Session.next()` теперь покрыта
  test-ом `test/contract/agent-controls.test.ts:765` (абзац «Test вне следа» выше).

**Как читать старый журнал Autopilot.** Строки `run-stopped` с причиной `user-stop` и Ticket-ами,
записанные между мержами Ticket-ов 17 (403f4c9) и 18 (4473a9e), значат прерывающий Stop, то есть
нынешний Force stop. Переводить их не нужно: журнал по причине никто не читает.
