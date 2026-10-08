# 02 — «Link a machine»: поиск по Bonjour или адресу, код на экране, список Linked machine-ов, отзыв, переключатель доступа

Type: task
Status: claimed — 2026-10-08
Blocked by: 01
Source: решения владельца 2026-10-07: Q4 (доступ выключен по умолчанию, код связи, токен устройства, отзыв), Q7 (host и client — роли соединения), Q10 (слева Project-ы всех Linked machine по Machine с состоянием «в сети», «спит», «недоступна»), Q11 («Link a machine»: Bonjour или адрес, код из 6 цифр, переключатель доступа по умолчанию выключен, отзыв с любой стороны) и Q12 (первая проверка — dev-сборка и Stable copy на одном Mac) ([spec.md](../spec.md), «Готово, когда» Epic-а, пункты 1 и 5); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md) (пункты 4, 6, 9; последствие про запрос Local Network)

## Что происходит

- После Ticket-а 01 (сервер связи Machine-ов) в main есть сервис связи: Machine с id, именем и
  сертификатом; pairing по коду; список Linked machine-ов; отзыв; причины, по которым сервер
  слушает; служебные сообщения; стенд двух Machine для test-ов `test/contract/link-bench.ts`. UI у
  него нет, и сам он ни с кем не соединяется.
- Общих настроек worfy в UI нет. Есть только настройки Project-а — модальное окно `ProjectSettings`
  (`src/renderer/shell/ProjectSettings.tsx`), его открывает строка Project-а
  (`src/renderer/shell/sidebar/ProjectsSection.tsx:203`).
- Боковая панель собирает секции сама. Файл `src/renderer/shell/sidebar/<Name>Section.tsx` с
  компонентом по умолчанию и `export const order` подхватывается без правки `Sidebar.tsx`
  (`src/renderer/shell/Sidebar.tsx:3-6`, `src/renderer/shell/registry.ts`). Порядок сейчас:
  Projects 10, Epics 20, Sessions 30, ADR 40.
- Состояние из main renderer держит hook-ом по образцу `src/renderer/projects/useProjects.ts`: новое
  состояние берётся, если его ревизия не меньше текущей (`:22`). Два события, пришедшие в обратном
  порядке, список не откатывают.
- Bonjour (DNS-SD — объявление сервисов в локальной сети) в worfy нет, библиотеки mDNS в
  `package.json` нет.
- Свой Bonjour-сервис на macOS 15+ вызывает запрос разрешения Local Network (Apple TN3179;
  ADR-0052, последствия). Вызывает ли его ещё что-то в worfy (например, исходящее соединение на
  адрес в LAN) и как он ведёт себя у ad-hoc подписанной сборки — не проверено. Ключей Info.plist
  для Local Network (`NSLocalNetworkUsageDescription`, `NSBonjourServices`) в `electron-builder.yml`
  нет; electron-builder задаёт их через `mac.extendInfo`.
- e2e: `launchApp` (`test/e2e/helpers.ts:111`) даёт каждому запуску свою временную папку данных
  (`:116`, `:127-134`). Два вызова в одном test-е — два worfy и две Machine; single-instance lock берётся
  по папке данных (`src/main/index.ts:26-34`), поэтому стартуют оба. `env.WORFY_DATA_DIR` в
  параметрах `launchApp` перекрывает временную папку (`:127-133`) — так worfy перезапускается над
  той же папкой. Снимки в двух темах — `snapshotThemes` (`test/e2e/snapshots.ts:36`).
- Ticket-ам 09, 13, 14 и 15 нужен helper двух связанных worfy из этого Ticket-а. Ticket 09
  дописывает свои test-ы в `test/e2e/linked-machines.spec.ts`, который создаёт этот Ticket.

## Что делаем

1. **IPC связи для UI** — домен `link` (`src/shared/ipc/link.ts`, handler-ы — `src/main/ipc/link.ts`,
   ADR-0006 — домен из двух файлов):
   - состояние этой Machine: id, имя, слушает ли сервер, адрес и порт для ввода руками;
   - список Linked machine-ов с состоянием `online` / `unavailable` («спит» добавит Ticket 14);
   - найденные по Bonjour worfy;
   - событие изменения с ревизией;
   - команды: открыть и закрыть «Link a machine», связать (адрес и код), отозвать, переключатель
     доступа.
   Токены и отпечатки сертификатов в renderer не попадают. Код попадает только на экран B, где
   его и показывают.
2. **«Link a machine»** (Q11). Окно открывают на обеих машинах.
   - Пока оно открыто, сервер слушает (причина «Link a machine» Ticket-а 01), Machine объявляет
     себя по Bonjour и ищет другие worfy.
   - Список найденных: имя и адрес. Своей Machine (по id в TXT-записи) и уже связанных в нём нет.
   - Поле адреса для ввода руками: `host:port`, IPv6 в скобках. Ошибка разбора — под полем.
   - На A выбирают worfy B. B показывает крупно 6-значный код и имя A. На A — поле кода.
   - Неверный код — сообщение на A; на B новый код (код одноразовый, Ticket 01).
   - Отказ по версии протокола показывается текстом сервера как есть («dev-сборка и Stable copy
     бывают разных версий»).
   - После связывания окно на обеих машинах показывает успех; строка появляется в списке.
3. **Bonjour.** Тип сервиса предлагается `_worfy._tcp`, в TXT — id Machine и версия протокола.
   - Объявление — пока сервер слушает. Поиск — пока открыт «Link a machine», и для
     переподключения (п. 5).
   - Библиотека — на выбор Ticket-а (кандидаты: `bonjour-service`, `multicast-dns`), без нативной
     сборки: тот же код пойдёт на Windows. Выбор — в «Итог».
   - Нужны ли ключи Info.plist по TN3179 — проверить. Нужны — `mac.extendInfo` в
     `electron-builder.yml`.
   - Переменная окружения по образцу `WORFY_*` (имя выбирает Ticket) выключает Bonjour. e2e идут с
     ней: запрос Local Network на экране остановил бы прогон.
4. **Список Linked machine-ов** — новая секция боковой панели (предлагается `MachinesSection.tsx`,
   `order` 15 — между Projects и Epics; место выбирает Ticket, решение — в «Итог»).
   - Строка: имя Machine, состояние «в сети» или «недоступна», в меню — «Revoke».
   - Под списком — кнопка «Link a machine…» и переключатель доступа (п. 7).
   - Пустой список — только кнопка и переключатель.
5. **Соединения.** Machine держит соединение с каждой Linked machine: соединяется при старте; после
   обрыва — повтор с растущей паузой (предлагается до 30 s); при новом адресе из Bonjour — сразу.
   Соединение открыто — «в сети», иначе — «недоступна». Состояние «certificate changed» Ticket-а 01
   показывается в строке с подсказкой связать заново.
6. **Отзыв с любой стороны** (Q11; ADR-0052, пункт 9) — через отзыв Ticket-а 01. Строка пропадает у
   обеих сторон. Отозванная Machine сразу теряет соединение.
7. **Переключатель «Linked machines can work with my Projects»** (Q11). Хранится в папке данных
   (предлагается `src/main/link/settings.ts`; рядом встанет переключатель Ticket-а 14), по
   умолчанию выключен. UI — в секции п. 4. Здесь он только хранится, показывается и шлёт событие
   изменения. Применяет его к каналам Ticket 08.
8. **Helper двух связанных worfy** для e2e — в `test/e2e/helpers.ts`: два worfy через `launchApp`,
   связанные через UI этого Ticket-а по адресу `127.0.0.1:<порт>`; отдаёт оба приложения и id обеих
   Machine. Его берут Ticket-ы 09, 13, 14 и 15 как есть.

Не входит: Project-ы Linked machine-ов в боковой панели (Ticket 09), состояние «спит» (Ticket 14),
применение переключателя доступа (Ticket 08). Переименование Machine владелец не решал — не делаем.

## Готово, когда

- [x] Unit `test/unit/link-discovery.test.ts` (mDNS подменён): своя Machine и уже связанные в списке найденных не показываются; worfy с другой версией протокола показан с пометкой; ушедший из сети пропадает из списка.
- [x] Unit там же: разбор адреса, введённого руками (`host:port`, `[::1]:port`, без порта, мусор).
- [x] Contract `test/contract/link-connections.test.ts` (стенд Ticket-а 01): обрыв соединения — «недоступна»; сервер B вернулся — «в сети» без действий пользователя.
- [x] Там же: отзыв с A и отзыв с B — у обеих сторон списки пусты, соединение закрыто.
- [x] Там же: переключатель доступа у свежей папки данных выключен, переживает перезапуск сервиса над той же папкой, его смена шлёт событие.
- [x] e2e `test/e2e/linked-machines.spec.ts` (локально, в gate full; Bonjour выключен, адрес `127.0.0.1:<порт>` из окна B): два worfy открывают «Link a machine»; на A введён адрес B, код из окна B (по `data-testid`) — на A. У обоих в секции — другая Machine «в сети».
- [x] Там же: неверный код — сообщение на A, код на B сменился, связи нет. Отзыв с A — строка пропала у обоих не позже чем через 5 s; связать заново по коду удаётся. Отзыв с B — то же.
- [x] Там же: у свежей Machine переключатель доступа выключен. Включённый, он включён и после перезапуска worfy над той же папкой данных.
- [x] Снимки в светлой и тёмной теме (helper `test/e2e/snapshots.ts`): «Link a machine» с кодом на B, с полем кода на A, секция с одной Linked machine. Цвета — существующие токены обеих тем (`src/renderer/theme/tokens.css`). Ссылка из «Итог» — `../evidence/02-link-a-machine.png`.
- [ ] (вручную) dev-сборка и Stable copy на одном Mac находят друг друга по Bonjour, связываются по коду; отзыв с любой стороны работает. В «Итог» — был ли запрос Local Network и на каком шаге. Как проверить: окна обеих копий.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all gate.sh full` — exit 0.

## Тесты

Сначала падающий test — `test/e2e/linked-machines.spec.ts`: на main нет кнопки «Link a machine»,
test падает на её поиске. В «Итог» — как он падал.

- `test/unit/link-discovery.test.ts` — список найденных и разбор адреса.
- `test/contract/link-connections.test.ts` — переподключение, отзыв с двух сторон, хранение
  переключателя; поверх стенда `test/contract/link-bench.ts` Ticket-а 01.
- `test/e2e/linked-machines.spec.ts` — связывание, неверный код, отзыв, переключатель на двух
  собранных worfy.

Bonjour в e2e выключен: живой поиск проверяется unit-test-ом с подменённым mDNS и вручную на
dev-сборке и Stable copy. Код в e2e берётся из DOM окна B — так, как его прочёл бы человек.

## Где в коде

- `src/shared/ipc/link.ts`
- `src/main/ipc/link.ts`
- `src/main/link/service.ts`
- `src/main/link/discovery.ts` (новый)
- `src/main/link/connections.ts` (новый)
- `src/main/link/settings.ts` (новый)
- `src/renderer/machines/useMachines.ts` (новый)
- `src/renderer/machines/LinkMachineDialog.tsx` (новый)
- `src/renderer/shell/sidebar/MachinesSection.tsx` (новый)
- `package.json`
- `pnpm-lock.yaml`
- `electron-builder.yml`
- `test/unit/link-discovery.test.ts` (новый)
- `test/contract/link-connections.test.ts` (новый)
- `test/e2e/linked-machines.spec.ts` (новый)
- `test/e2e/helpers.ts`
- `src/main/index.ts` (круг доработки 1: остановка связи на `before-quit`; в следах соседей по волне его нет)

`Sidebar.tsx` и `ProjectsSection.tsx` этот Ticket не меняет: секция — новый файл. Файлы папки связи
и их имена — как в «Итог» Ticket-а 01; если они там другие, список выше правится при claim.
`electron-builder.yml` меняется, только если нужны ключи Info.plist. С Ticket-ом 03 (реестр
клиентов) общий `test/e2e/helpers.ts`: он добавляет туда helper второго окна.

## Итог

Сделано в ветке `worfy-link/02`.

- **Первый test падал так.** `test/e2e/linked-machines.spec.ts` и новый `test/e2e/helpers.ts` поверх сборки `origin/main`
  (487f043): `4 failed`. Первый test — `waiting for getByTestId('machines-section')` (секции нет), второй и третий —
  `locator.click: Timeout 30000ms exceeded … waiting for getByTestId('link-machine-button')` (нет кнопки «Link a
  machine…»), четвёртый — `No handler registered for 'worfy:link.state'`.
- **Файлы.** IPC: `src/shared/ipc/link.ts` (каналы `link.state`, `link.open`, `link.close`, `link.pair`, `link.revoke`,
  `link.setAccess`, событие `link.changed`; разбор адреса `parseLinkAddress`), `src/main/ipc/link.ts`. Main:
  `src/main/link/discovery.ts` (Bonjour), `connections.ts` (переподключение), `settings.ts` (переключатель доступа),
  `service.ts` (настройки, `addresses()`, `noteAddress()`, `isLinked()`, `isStopped`, отказ связать Machine саму с собой;
  внизу — сборка приложения: `appLink()`, `wireAppLink()`, `onAppLinkStart()`, `stopLink()`, `stopAppLink()`).
  `src/main/index.ts` — остановка связи на `before-quit` (круг доработки 1). Renderer:
  `src/renderer/machines/useMachines.ts`, `LinkMachineDialog.tsx`, `src/renderer/shell/sidebar/MachinesSection.tsx`.
  Вне первоначального «Где в коде» — только `src/main/index.ts` (добавлен в список).
- **Новый файл папки данных:** `link/settings.json` — `{ "version": 1, "projectsAccess": false|true }`. Нет файла или он
  не читается — доступ выключен.
- **Переменные окружения.** `WORFY_LINK_HOST` — единственный адрес, который слушает сервер связи (без неё — `::`, затем
  `0.0.0.0`, как в Ticket-е 01). `WORFY_LINK_BONJOUR=0` (`false`, `off`) — Bonjour выключен. `launchApp` ставит обе
  (`127.0.0.1` и `0`) каждому e2e: брандмауэр macOS не спрашивает про входящие соединения, запроса Local Network нет.
- **Helper двух связанных worfy** (для Ticket-ов 09, 13, 14, 15) — `test/e2e/helpers.ts`: `launchLinkedPair()` отдаёт
  `{ a, b, aId, bId, close }`; рядом `linkThroughUi(a, b)`, `openLinkDialog`, `chooseByAddress`, `shownCode`,
  `machineIdOf`.
- **Библиотека Bonjour — `bonjour-service` 1.4.4** (MIT; чистый JS над UDP multicast, без нативной сборки, тот же код
  пойдёт на Windows). Тянет `multicast-dns` 7.2.5, `dns-packet` 5.6.1, `@leichtgewicht/ip-codec` 2.0.5, `thunky` 1.1.0,
  `fast-deep-equal` 3.1.3 — все MIT. На диске в `node_modules` — около 450 КБ (`du -sk` по каждому пакету, с картами и
  типами). Сокет открывается только при первом объявлении или поиске. `multicast-dns` напрямую не взят: записи DNS-SD
  (PTR, SRV, TXT, A) и пробу имени пришлось бы писать самим.
- **Info.plist (TN3179).** В `electron-builder.yml`, `mac.extendInfo`: `NSLocalNetworkUsageDescription` (текст запроса
  Local Network) и `NSBonjourServices: [_worfy._tcp]`. Нужность — по TN3179, не на устройстве. Что ключи попали в
  сборку, проверено: `plutil -extract` по `dist/mac-arm64/worfy.app/Contents/Info.plist` после `test:package` выдаёт
  оба; `bonjour-service` и `multicast-dns` лежат в `app.asar`.
- **Снимки** (обе темы, `snapshotThemes`): «Link a machine» с кодом на B — [../evidence/02-link-a-machine.png](../evidence/02-link-a-machine.png)
  (он же `02-link-a-machine-code-light.png`, тёмная — `02-link-a-machine-code-dark.png`); с полем кода на A —
  `02-link-a-machine-code-field-{light,dark}.png`; секция Machines с одной Linked machine — `02-machines-section-{light,dark}.png`.
  Цвета — только роли из `tokens.css` (`surface`, `surface-raised`, `border`, `border-strong`, `text*`, `primary`,
  `segment-track`, `blocked-text`, чипы `ready`/`blocked`).

Решения (все — **решено без владельца, подтвердить**):

- **Секция Machines — `order` 15**, между Projects и Epics. Строка: имя, чип «Online» (`ready`), «Unavailable» (нейтральный:
  `surface-raised`, `border`, `text-muted`) или «Certificate changed» (`blocked`, подсказка «Revoke it, then link it
  again»). «Revoke» — в контекстном меню строки, без подтверждения. Под списком — «Link a machine…» и переключатель.
- **Окно одно на обе роли.** Каждая сторона показывает свой код и свой адрес; на любой из них выбирают другую (из найденных
  или по адресу) и вводят её код. Имя A на B показывается в сообщении об успехе («Linked with A»), а не рядом с кодом:
  до ввода кода B имени A не знает.
- **Тип сервиса `_worfy._tcp`**, TXT: `id`, `proto`, `name`; имя экземпляра — `<имя Machine> (<первые 8 знаков id>)`:
  у двух worfy на одном Mac имена Machine совпадают.
- **Поиск по Bonjour** — пока открыт «Link a machine» и пока хотя бы одна Linked machine недоступна. Объявление — пока
  сервер слушает; при выходе worfy шлёт goodbye (до 1.5 s), и другие worfy убирают её из списка сразу, а не через TTL.
- **Объявление по Bonjour — заявка, не доказательство** (круг доработки 1): объявить любой id с любого адреса может кто
  угодно в сети. Берутся только адреса локальной сети (`checks.ts`) или имя `*.local`; хранится не больше 64 объявлений;
  два адреса у одного id показываются оба, с пометкой «Two addresses»; Linked machine, найденная по Bonjour, — не чаще
  раза в 10 s. По такому адресу Machine звонит один раз и только если соединения нет ни в одну сторону. Адрес
  запоминается, только когда там ответил запомненный сертификат. Чужой сертификат там — «недоступна» с причиной в
  подсказке; запись и пометка «certificate changed» не меняются, пауза между повторами не растёт.
- **Переподключение:** обе стороны соединяются друг с другом сами; пауза после обрыва или неудачи 1, 1, 2, 4, 8, 16 s,
  затем 30 s; «в сети», пока открыто хоть одно соединение (входящее или исходящее).
- **Имя Machine в строке:** хвост в скобках («(dev)») не обрезается, многоточие — в имени перед ним.
- **`link.changed` — только окнам этой Machine** (`BrowserWindow`), не всем клиентам `broadcast.ts`: в состоянии код
  связи, а клиент без окна — соединение Linked machine (Ticket 08). `link.state` и остальные новые каналы не в
  `LINK_OPEN_CHANNELS`.

Проверки: `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0 (147 файлов, 2832 test-а); `gate.sh fast` — exit 0,
«зелено»; `GATE_SCOPE=all gate.sh full` — exit 0, «зелено (full): lint typecheck test test:e2e test:package»;
`test/e2e/linked-machines.spec.ts` — `4 passed`.
Mutation-проверка в своём worktree (вернул из копии): без повтора после обрыва, без немедленного соединения по Bonjour,
с доступом «включён» по умолчанию, без фильтра Linked machine-ов, без удаления ушедшего, без пометки другой версии —
test-ы краснеют все шесть. Круг доработки 1 — ещё 11: чужой сертификат по адресу из Bonjour ставит «certificate
changed»; адрес не запоминается после проверки; неудача по объявлению удлиняет паузу; пауза всегда первая
(`delayFor(1)`); без фильтра адресов локальной сети; без предела 64; без пометки конфликта; без ограничения частоты
`seen`; сокет закрыт до goodbye; `stopLink` без остановки Bonjour; слушатель `destroyed` на каждое открытие — все
краснеют.

- не проверено: dev-сборка и Stable copy на одном Mac по Bonjour, связывание по коду и отзыв с любой стороны; был ли
  запрос Local Network и на каком шаге. Бриф запрещает системные окна на машине владельца и пересборку Stable copy;
  проверять — окнами обеих копий.
- не проверено: сам обработчик `before-quit` в `src/main/index.ts` — test-ом покрыт `stopLink` (goodbye, затем
  закрытие сокета, остановка соединений и сервиса), а вызов на выходе приложения — нет: в e2e Bonjour выключен.
- Ограничение (Ticket 01): если у отзывающей Machine после отзыва не осталось Linked machine-ов, её сервер закрывается.
  Отозванная сторона, которая в этот момент не была на связи, видит её «Unavailable», пока не отзовёт сама: отказа 401
  ей получить не от кого. При открытом соединении отзыв доходит сразу (test-ы с двух сторон).
