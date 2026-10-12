# 13 — Уведомления на Linked machine-ах и «не беспокоить» на каждой

Type: task
Status: done — 2026-10-09, [PR #183](https://github.com/IDSAD-XL/worfy/pull/183)
Branch: worfy-link/13
Blocked by: 09
Source: решения владельца 2026-10-07: Q16 (уведомления — Machine Project-а и подключённым Linked machine; «не беспокоить» на каждой) и Q6 (уведомления — в другом worfy, не в браузере) ([spec.md](../spec.md)); [ADR-0053](../../../docs/adr/0053-several-screens-on-one-project.md)

## Что происходит

- Уведомления показывает main той машины, где идёт Session.
  - `Notifier` (`src/main/notify.ts:68`) решает, о чём уведомить. Первый случай — Session, которую ведёт worfy: её `result` (кроме прерванного хода) и каждый `permission_request` (`:79-110`), подписка через `SessionRegistry.observe` (`:222`). Второй — Session из реестра `~/.claude` (терминал, Claude desktop), перешедшая из `busy` в `idle` (`:113-127`). Её видят только watcher-ы реестра, которые запустили подписчики hub-а claude-home (`liveSessionListeners`, `src/main/ipc/claude-home.ts:39`, подписка — `:146-147`).
  - Правила показа — в `notify` (`:143-150`). Фокус у окна worfy — уведомления нет (`focused`, `:196`, это `BrowserWindow.getFocusedWindow() !== null`). Одна Session — не чаще раза в `NOTIFY_INTERVAL_MS`, 10 s (`:30`). Уведомление, придержанное из-за фокуса, в эти 10 s не считается.
  - Показ — `new Notification` (`:199`).
  - Клик — `openNote` (`:176-192`). Он поднимает окно или создаёт новое и кладёт заметку в `PendingOpens` по `webContents.id` (`holdFor`, `:160-170`; `src/main/notify-pending.ts:17`). Открытому окну он шлёт `notify.open`. Renderer забирает заметку через `notify.pending` (`src/main/ipc/notify.ts:8`, по `event.sender.id`) и открывает Session (`src/renderer/canvas/overlays/NotificationTarget.tsx:23-47`). Node Session ищет `notificationTarget` (`src/renderer/session/notification-target.ts:19-29`).
  - Заметка — `{ sessionId, projectRoot }` (`src/shared/ipc/notify.ts:11-16`). Machine в ней нет. Renderer ищет Session среди views своих Project-ов и в активном Project-е.
  - Включает всё это `installNotifications` (`src/main/index.ts:87`).
- Своего «не беспокоить» в worfy нет: `grep -rniE 'disturb|dnd' src` пуст. «Не беспокоить» — это режим Focus ОС. Он гасит уведомления только той машины, на которой включён.
- Что будет после блокеров. Ticket 03 (реестр клиентов вместо окон Electron) переводит `notify.pending` и подписки hub-ов с окна на клиента. Клиентом становится и соединение Linked machine-а. Ticket 09 (Project-ы Linked machine-ов в боковой панели и на Canvas) открывает Project другой машины. В renderer такой Project различается парой Machine + projectId.
- Session Project-а живёт на машине Project-а, даже если её запустили с другой машины (Ticket 04 — Session не зависит от окна). Поэтому её события видит только `Notifier` машины Project-а. Linked machine, где открыт этот Project, уведомлений о нём не получает.

## Что делаем

1. **Кому.** Уведомление о Session показывают машина Project-а (как сейчас) и каждая Linked machine, подключённая к Project-у (Q16 — уведомления показывают машина Project-а и подключённые к нему Linked machine-ы). Связь двусторонняя: Project-ы второй машины так же уведомляют первую.
   - Что значит «подключена к Project-у» — определение этого Ticket-а. Владелец его отдельно не решал, подтверждает при claim.
   - Определение: у Linked machine сейчас есть соединение с машиной Project-а (Ticket 01 — сервер связи Machine-ов). Машина Project-а открыла ей свои Project-ы: её переключатель «Linked machines can work with my Projects» включён (Ticket 02 хранит переключатель, Ticket 08 его применяет).
   - Это тот же набор Project-ов, что Linked machine видит в боковой панели (Ticket 09). Открытый Canvas Project-а не нужен: на одной машине уведомление тоже приходит о Project-е, Canvas которого сейчас не открыт. Без доступа клик всё равно не откроет Session — поэтому при выключенном переключателе заметка не уходит.
2. **Решает машина Project-а, показывает каждая.** `Notifier` делится на две части.
   - Машина Project-а решает, о чём уведомить. Правила `sessionEvent` и `externalSessions` не меняются. Заметку она отдаёт двум адресатам: своему показу и соединениям подключённых Linked machine-ов. Свой фокус на отправку не влияет.
   - По соединению идёт заметка `{ title, body, sessionId, projectRoot }`. Machine отправителя получатель берёт из соединения, а не из сообщения.
   - Это служебное сообщение связи Ticket-а 01, а не канал `src/shared/ipc`. В список каналов, которые Ticket 08 помечает разрешёнными или запрещёнными, оно не входит.
   - Каждая машина применяет к заметке свои правила показа: фокус своего окна worfy и 10 s на Session с ключом Machine + sessionId. Фокус окна на одной машине не гасит показ на другой.
3. **Клик.** Работает на машине, где кликнули.
   - `openNote` поднимает окно этой машины. Заметка ждёт в `PendingOpens` по клиенту (Ticket 03) и несёт Machine: в `notifyOpenSchema` появляется `machineId` (null — эта машина).
   - `notificationTarget` ищет Session среди views Project-ов этой Machine и открывает её так же, как Ticket 09 открывает Project Linked machine-а.
   - Машина Project-а на клик по чужому уведомлению ничего не делает, её окно не поднимается.
4. **«Не беспокоить» — своё на каждой машине** (Q16). Каждая машина показывает уведомление своей ОС, поэтому её Focus действует сам. Между машинами не передаются ни фокус, ни Focus ОС, ни счёт 10 s. Своего переключателя worfy не заводит.
5. **Нет связи.** Linked machine недоступна или спит — заметка ей не уходит и не копится. После возвращения старые уведомления не приходят.

Не входит: `app.setAppUserModelId` для уведомлений на Windows (Epic worfy-windows). Session из реестра `~/.claude`, которую сейчас не смотрит ни один watcher, уведомления по-прежнему не даёт.

## Готово, когда

- [x] Unit `test/unit/notify.test.ts`: на машине Project-а при фокусе её окна `result` Session не показан, но заметка ушла в соединение подключённой Linked machine. Без фокуса — показан и ушёл туда же. Правила «10 s на Session» и «придержанное не считается» держатся на каждой машине своим счётом.
- [x] Unit `test/unit/link-notify.test.ts` (новый): две Machine с двумя папками данных в одном процессе vitest (стенд Ticket-а 01). `result` и `permission_request` Session Project-а машины A показаны на B с теми же title и body. При выключенном переключателе доступа на A или без соединения B ничего не получает. B с фокусом своего окна не показывает, A при этом показывает. Переподключившаяся B старых заметок не получает.
- [x] Unit там же: клик на B кладёт заметку с Machine A в `PendingOpens` клиента B. `notify.pending` отдаёт её этому клиенту один раз. `open` машины A не вызван.
- [x] Unit `test/unit/permission-card.test.tsx` (там уже проверяется `notificationTarget`, `:180-192`): заметка с Machine A находит Session Node Project-а A на B. Заметка с той же `sessionId` без Machine находит локальную Session.
- [x] e2e `test/e2e/linked-notify.spec.ts` (новый, локально в gate full): два worfy, связанные helper-ом Ticket-а 02, окна обоих без фокуса. Ход fake-агента в Session Project-а A кончается — уведомление записано на обоих. Клик на B открывает эту Session на Canvas Project-а A в окне B (`data-testid` открытой Session).
- [x] Одна машина без Linked machine-ов ведёт себя как раньше: прежние test-ы `test/unit/notify.test.ts` зелёные без правки ожиданий.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all gate.sh full` — зелёный.

Ручная проверка на dev-сборке и Stable copy — в Ticket-е 16 (приёмка Epic-а), пункт 4.

## Тесты

Сначала падающий test — `test/unit/link-notify.test.ts`: `result` Session машины A не доходит до `show` машины B. В «Итог» — как test падал.

Перехват уведомления в e2e — без правки продукта. `app.evaluate` подменяет `Notification.prototype.show`: экземпляр записывается в массив, системное уведомление не показывается. Клик — `emit('click')` записанного экземпляра: `notify.ts` подписан на `click` через `on` (`:201`). Фокус снимается `BrowserWindow.blur()` через `app.evaluate`. Если подмена прототипа не срабатывает, нужна переменная только для test-ов по образцу `WORFY_AGENT_LOG` (`src/main/agent/app-registry.ts:3-5`, `:74-78`). Причину записать в «Итог».

Helper двух связанных worfy берётся из Ticket-а 02 как есть. Если ему чего-то не хватает, недостающее живёт в самом spec-файле: `test/e2e/helpers.ts` этот Ticket не правит, чтобы не пересекаться с соседями по Wave.

## Где в коде

- `src/main/notify.ts`
- `src/main/notify-pending.ts`
- `src/main/ipc/notify.ts`
- `src/shared/ipc/notify.ts`
- `src/main/index.ts`
- `src/main/link/notes.ts` (новый)
- `src/renderer/session/notification-target.ts`
- `src/renderer/canvas/overlays/NotificationTarget.tsx`
- `test/unit/notify.test.ts`
- `test/unit/link-notify.test.ts` (новый)
- `test/unit/permission-card.test.tsx`
- `test/e2e/linked-notify.spec.ts` (новый)

При claim сюда дописывается файл служебных сообщений связи из Ticket-а 01. Его путь будет в «Итог» Ticket-а 01.

- Служебные сообщения связи (Ticket 01): `src/main/link/messages.ts` (`defineLinkMessage`) и
  `LinkService.registerMessage` / `sendMessage` в `src/main/link/service.ts` — только используются, без правки.
  Сообщение заметки определяется в `src/main/link/notes.ts`.

## Итог

Сделано в ветке `worfy-link/13`.

- **Первый test падал так.** `test/unit/link-notify.test.ts` против `src/main/link/notes.ts`, где `LinkNotes`
  ничего не делал (только схема сообщения): 9 из 9 красные. Восемь — `Test timed out in 5000ms`: `result` и
  `permission_request` Session машины A не доходили до `show` машины B. Девятый — нет предупреждения
  «sent message note outside its schema; dropped»: B не знал сообщения `note`.
- **Как устроено.**
  - `Notifier` (`src/main/notify.ts`) делится на решение и показ. Правила `sessionEvent` / `externalSessions`
    прежние. Решённая заметка идёт в `NoteDisplay` этой машины и в `NoteLink.send` — независимо от фокуса
    и от 10 s машины Project-а.
  - `NoteDisplay` — правила показа одной машины: фокус её окна, 10 s с ключом Machine + sessionId.
    Придержанная фокусом заметка не считается. Записи старше 10 s забываются при показе: Session-ы
    Linked machine-а не сообщают о закрытии.
  - `src/main/link/notes.ts` — служебное сообщение связи `note` `{ title, body, sessionId, projectRoot }` и
    `LinkNotes`. Отправка — только при включённом «Linked machines can work with my Projects» и только
    подключённым сейчас машинам (`isConnected`), без очереди. Machine отправителя — из соединения
    (`from.machineId`). Полученная заметка показывается и дальше не уходит: машина шлёт только заметки
    о своих Session-ах. `appNoteLink()` подключается к связи приложения, когда та запустилась
    (`onAppLinkStart`): связь стартует после `installNotifications`.
  - Клик на B: `openNote` поднимает окно B и кладёт заметку с `machineId` в `PendingOpens`.
    `notifyOpenSchema.machineId` — `string | null`, необязательное (null или нет поля — эта машина).
  - Renderer: `notificationTarget(note, project, machine)` ищет только среди views Machine окна. Окно на
    другой Machine (`NotificationTarget.tsx`) спрашивает Machine заметки, в каком её Project-е Session
    (`projectOfNote`: `projects.list` и `sessions.views` через `invokeOn`). Потом окно грузится заново на
    этом Project-е этой Machine (`addressFor` Ticket-а 09). Заметка переживает перезагрузку в
    `sessionStorage` окна (`carryNote` / `takeCarriedNote`, срок — прежний `NOTE_WAIT_MS`). На своей
    Machine окно ищет Session во всех её Project-ах и открывает её Project через `openProject`, как
    боковая панель.
- **Test-ы.** `test/unit/link-notify.test.ts` (новый, стенд Ticket-а 01): показ на B с теми же title и body,
  связь в обе стороны, без пересылки третьей машине, выключенный доступ, нет соединения и
  переподключение, фокус и 10 s на каждой машине своим счётом, клик на B → `PendingOpens` клиента B
  → `notify.pending` один раз, `open` машины A не вызван, заметка вне схемы. `test/unit/notify.test.ts`: прежние
  test-ы без правки ожиданий; новые — заметка уходит в связь при фокусе, отправка без счёта 10 s,
  свой счёт по Machine для полученных, клик с Machine, `PendingOpens` с `machineId`.
  `test/unit/permission-card.test.tsx`: заметка с Machine A находит Node Project-а A в окне на A, та же
  `sessionId` без Machine — локальную; перезагрузка на нужный Project с переносом заметки; поиск
  во всех Project-ах после перезагрузки; просроченная перенесённая заметка; возврат на свою машину;
  более новый клик во время поиска на другой машине побеждает. Мутанты каждого правила (пересылка
  полученной, отправка без доступа, ключ 10 s без Machine, фокус гасит отправку, `notificationTarget` без
  проверки Machine, без `carryNote`, поиск только в активном Project-е, без защиты от более нового
  клика) — каждый красный.
- **e2e** `test/e2e/linked-notify.spec.ts`: два worfy, связанные через UI (helper-ы `launchApp`,
  `linkThroughUi` из `helpers.ts` без правки). `setSharing`, `gitRepo`, `dataFolder`, `call` — копии в самом
  spec-файле. Подмена `Notification.prototype.show` через `app.evaluate` сработала, переменная для test-ов
  не понадобилась. Фокус снимается `BrowserWindow.blur()`, test ждёт `getFocusedWindow() === null`.
  Клик — `emit('click')` записанного экземпляра.

- **Проверки.** `pnpm lint && pnpm typecheck && pnpm test` и `GATE_SCOPE=all gate.sh full` — зелёные (full: lint,
  typecheck, test, test:e2e, test:package). CI PR #183 — `check` pass. `gate.sh fast` дважды дал красный test
  из-за `Test timed out in 15000ms` в `test/contract/harness-qmd.test.ts`, `docs.test.ts`, `github-prs.test.ts`,
  `workflow-reader.test.ts`. Эти test-ы не касаются уведомлений. Машина в это время была нагружена (load
  average 6–7: test-ы других агентов волны). Отдельно эти четыре файла зелёные (141 test).

Решения (все — **решено без владельца, подтверждено владельцем 2026-10-12**):

- **«Подключена к Project-у»** — как в «Что делаем»: соединение есть сейчас и переключатель доступа
  машины Project-а включён. Открытый Canvas не нужен.
- **Машина Project-а шлёт каждую решённую заметку**, свой счёт 10 s применяет только к своему показу:
  иначе фокус или 10 s машины A гасили бы показ на B. Частота ограничена самими событиями: конец хода
  и запрос разрешения.
- **Перенос заметки через перезагрузку окна — `sessionStorage`**, без нового канала IPC. Вариант с каналом
  «положи заметку обратно в `PendingOpens`» требовал нового канала с пометкой доступа. `sessionStorage`
  живёт только в этом окне и только до его закрытия, срок заметки проверяется при чтении.
- **Окно на другой Machine грузится сразу на Project Session.** Без Project-а окно на Linked machine
  показывает «No project», и overlay с Canvas не монтируется. Поэтому Project ищется до перезагрузки.
  Не нашёлся (Orchestrator, Session уже закрыта) — активный Project той машины.
- **Заметка о своей Session в окне на Linked machine** возвращает окно на эту машину. До Ticket-а окно
  искало бы её среди views чужой машины.

Не проверено:

- **Ручная проверка с настоящим баннером на второй Machine** и Focus («не беспокоить») macOS на каждой —
  не проверено: бриф запрещает настоящие уведомления и трогать Focus. Остаётся пунктом 4 Ticket-а 16.
- Переименование Session машины A в SDK id (`renamed`) не передаётся на B. Счёт 10 s на B может начаться
  заново под новым id. На практике `renamed` приходит до первого `result`, так что это не проверялось
  отдельным test-ом.
- Снимков UI нет: видимое не менялось (`NotificationTarget` ничего не рисует, переключателя «не
  беспокоить» worfy не заводит).

### Gate оркестратора (2026-10-09)

- Круг 1 — `VERIFIED` ([комментарий в PR #183](https://github.com/IDSAD-XL/worfy/pull/183#issuecomment-6076314835)), с долгами:
  - [low] `src/renderer/canvas/overlays/NotificationTarget.tsx:68-69`, `:47` — между записью заметки в sessionStorage и загрузкой страницы `notify.open` более нового клика может попасть в старую страницу; та заберёт его через одноразовый `notify.pending`, и новый клик потеряется (окно — миллисекунды, не воспроизведено). Исправление: флаг «страница уходит» перед `navigation.load`, при нём `notify.pending` не звать.
  - [low] `NotificationTarget.tsx:45` — `holdNote(carried.note)` заново даёт полные 10 s: перенесённая заметка ждёт до ~20 s. Исправление: передавать `carried.until - NOTE_WAIT_MS` как `now`.
- Мерж: rebase на `c51edce`, `GATE_SCOPE=all gate full` — код 0 с первого прогона, CI зелёный, CLEAN, влит `b415879`.
