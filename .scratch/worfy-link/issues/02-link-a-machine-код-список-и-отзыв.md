# 02 — «Link a machine»: поиск по Bonjour или адресу, код на экране, список Linked machine-ов, отзыв, переключатель доступа

Type: task
Status: open
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

- [ ] Unit `test/unit/link-discovery.test.ts` (mDNS подменён): своя Machine и уже связанные в списке найденных не показываются; worfy с другой версией протокола показан с пометкой; ушедший из сети пропадает из списка.
- [ ] Unit там же: разбор адреса, введённого руками (`host:port`, `[::1]:port`, без порта, мусор).
- [ ] Contract `test/contract/link-connections.test.ts` (стенд Ticket-а 01): обрыв соединения — «недоступна»; сервер B вернулся — «в сети» без действий пользователя.
- [ ] Там же: отзыв с A и отзыв с B — у обеих сторон списки пусты, соединение закрыто.
- [ ] Там же: переключатель доступа у свежей папки данных выключен, переживает перезапуск сервиса над той же папкой, его смена шлёт событие.
- [ ] e2e `test/e2e/linked-machines.spec.ts` (локально, в gate full; Bonjour выключен, адрес `127.0.0.1:<порт>` из окна B): два worfy открывают «Link a machine»; на A введён адрес B, код из окна B (по `data-testid`) — на A. У обоих в секции — другая Machine «в сети».
- [ ] Там же: неверный код — сообщение на A, код на B сменился, связи нет. Отзыв с A — строка пропала у обоих не позже чем через 5 s; связать заново по коду удаётся. Отзыв с B — то же.
- [ ] Там же: у свежей Machine переключатель доступа выключен. Включённый, он включён и после перезапуска worfy над той же папкой данных.
- [ ] Снимки в светлой и тёмной теме (helper `test/e2e/snapshots.ts`): «Link a machine» с кодом на B, с полем кода на A, секция с одной Linked machine. Цвета — существующие токены обеих тем (`src/renderer/theme/tokens.css`). Ссылка из «Итог» — `../evidence/02-link-a-machine.png`.
- [ ] (вручную) dev-сборка и Stable copy на одном Mac находят друг друга по Bonjour, связываются по коду; отзыв с любой стороны работает. В «Итог» — был ли запрос Local Network и на каком шаге. Как проверить: окна обеих копий.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all gate.sh full` — exit 0.

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

`Sidebar.tsx` и `ProjectsSection.tsx` этот Ticket не меняет: секция — новый файл. Файлы папки связи
и их имена — как в «Итог» Ticket-а 01; если они там другие, список выше правится при claim.
`electron-builder.yml` меняется, только если нужны ключи Info.plist. С Ticket-ом 03 (реестр
клиентов) общий `test/e2e/helpers.ts`: он добавляет туда helper второго окна.

## Итог

Заполняется при закрытии.
