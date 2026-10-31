# worfy-link: Linked machines

Status: по решениям владельца 2026-10-07 (сводка решений Q1–Q25 подтверждена владельцем целиком;
«Готово, когда» и имя Epic-а — тоже)
Source: [roadmap.md](../../docs/roadmap.md), раздел `worfy-link`; [CONTEXT.md](../../CONTEXT.md), термины
Machine и Linked machine; ADR этого docs-PR — [ADR-0052](../../docs/adr/0052-machines-and-linking.md)
(Machine и связь по коду), [ADR-0053](../../docs/adr/0053-several-screens-on-one-project.md) (несколько
экранов на одном Project-е), [ADR-0054](../../docs/adr/0054-full-windows-port.md) (полный порт под Windows),
[ADR-0055](../../docs/adr/0055-harness-scripts-in-node.md) (скрипты Harness на Node),
[ADR-0056](../../docs/adr/0056-windows-checks-and-two-sessions.md) (проверка Windows и две Session-ы). Epic [worfy-harness](../worfy-harness/spec.md) — формат и
соглашения; Epic [worfy-windows](../worfy-windows/spec.md) — идёт параллельно.
Ticket-ы: Epic `worfy-link`, 16 Ticket-ов, нумерация с `01`. Шапка — тот же диалект, что у worfy-week
и worfy-harness (`Type:` / `Status:` / `Blocked by:` / `Source:`), чтобы её читали `epic-status`,
`ticket` и вычисление Wave в worfy (`src/shared/workflow/waves.ts`).

## Цель

Владелец работает с Project-ом одной своей Machine (компьютера с worfy) с другой. Например, Project
живёт на Mac, а его Canvas, Session-ы и Terminal открыты на Windows-ПК. Работа выполняется на Machine
Project-а, оба экрана видят её вживую. Связь — по локальной сети; с 2026-10-18 и через overlay-сеть
Tailscale при включённой настройке ([ADR-0070](../../docs/adr/0070-worfy-link-outside-the-lan-through-an-overlay-network.md)). Без Linked machine worfy
ведёт себя как сейчас: порт закрыт, в списке только свои Project-ы.

Epic готов, когда:

1. Два worfy связываются по коду — сначала dev-сборка и Stable copy (собранная копия worfy вне
   репозитория) на одном Mac, потом Mac и Windows; отзыв работает.
2. С другой машины можно открыть Canvas Project-а, править его, писать в Session, печатать в
   Terminal, запускать и останавливать Autopilot — всё выполняется на машине Project-а, оба экрана
   обновляются вживую, камера и ⌘Z у каждого свои.
3. Session, запущенная удалённо, переживает закрытие окна; «Add Project» на Linked machine — через
   просмотр её папок.
4. Уведомления приходят на подключённые машины; машина Project-а не засыпает, пока подключены;
   второй Autopilot на тот же Epic не стартует.
5. По умолчанию доступ выключен; проверка Origin/Host покрыта test-ами; токены не логируются.

Камера — положение и масштаб Canvas на экране. Origin и Host — заголовки HTTP-запроса; их проверка
не даёт чужой веб-странице подключиться к worfy.

Проверку всех пяти пунктов делает Ticket 16. Часть на одном Mac идёт сразу после Ticket-ов 01–15.
Пара Mac + Windows — после приёмки Epic-а worfy-windows: до него worfy на Windows нет.

## Как устроено

- **Machine** ([ADR-0052](../../docs/adr/0052-machines-and-linking.md), Ticket 01). При первом старте над
  папкой данных Machine получает id (UUID), имя и ключ с самоподписанным сертификатом. Machine
  привязана к папке данных, а не к компьютеру. dev-сборка, Stable copy и каждый e2e-запуск — разные
  Machine (`WORFY_DATA_DIR`, `src/main/storage/paths.ts:30-34`). Поэтому связь проверяется на одном
  Mac.
- **Сервис связи — в main** (Ticket 01, новая папка `src/main/link/`). HTTPS и WebSocket поверх него
  (`wss`), TLS 1.3, пакет `ws` в режиме `noServer`. До перехода на WebSocket (upgrade) сервер
  отказывает:
  - адресу не из локальной сети и не loopback (с ADR-0070 — кроме адресов Tailscale на интерфейсе
    Tailscale при включённой настройке «Связь через Tailscale», Ticket 27);
  - заголовку `Host` не из списка своих имён и адресов;
  - любому запросу с заголовком `Origin` — его всегда шлёт браузер и не шлёт клиент worfy;
  - чужой версии протокола связи;
  - неверному токену. Токен идёт в заголовке `Authorization`, а не в адресе: адрес попадает в логи.
- **Когда сервер слушает** (Ticket 01). Только пока есть причина: хотя бы одна Linked machine или
  открытое окно «Link a machine». Над свежей папкой данных порт закрыт. Порт выбирает ОС при первом
  запуске и сохраняет в папке данных — это предложение Ticket-а 01: два worfy на одном Mac не делят
  порт.
- **Связывание по коду** (Ticket-ы 01 и 02). «Link a machine» находит worfy через Bonjour (DNS-SD —
  объявление сервисов в локальной сети) или берёт адрес, введённый руками. Machine B показывает
  6-значный код, его вводят на A.
  - Код подтверждает отпечатки сертификатов обеих сторон. Посредник в сети не запомнится вместо
    настоящей Machine.
  - Перехват не даёт подбирать код офлайн. Для этого нужен протокол вроде PAKE (обмен ключами по
    паролю); библиотеку выбирает Ticket 01.
  - Код одноразовый и живёт ограниченное время.
  - После кода каждая сторона хранит отпечаток сертификата другой и токен для входа к ней. Токен,
    выданный самой Machine, она хранит только хэшем SHA-256.
- **Служебные сообщения связи** (Ticket 01) — кадры main ↔ main, а не каналы IPC: `hello` и
  `revoked`. Своё сообщение регистрирует модуль: так делают уведомления (Ticket 13), «засыпаю»
  (Ticket 14) и вопрос о прогонах Autopilot (Ticket 15).
- **IPC по соединению** (Ticket-ы 01 и 08). Адаптер `IpcMainLike` (`src/main/ipc/index.ts:51-53`)
  регистрирует те же handler-ы, что и для окна. Контракт тот же: JSON, схемы zod, ответ `{ok, value}`
  или `{ok:false, error}`. Ticket 08 помечает каждый канал в его объявлении:
  - `link` — служебный канал связи, открыт всегда;
  - `project` — работа с Project-ами этой Machine, открыт, когда включён доступ;
  - `desktop` — нужен рабочий стол машины Project-а, Linked machine-у закрыт;
  - `local` — состояние машины экрана, Linked machine-у закрыт.

  Канал без пометки не проходит `pnpm typecheck`. Каждый канал `project` несёт второй признак —
  `read` или `write` (Ticket 18, [ADR-0066](../../docs/adr/0066-read-only-access-for-a-linked-machine.md));
  без него канал `project` тоже не проходит `pnpm typecheck`.
- **Доступ** (ADR-0052, пункт 6). Переключатель «Linked machines can work with my Projects» у каждой
  Machine свой и по умолчанию выключен. Хранит его Ticket 02, применяет Ticket 08. Выключен — открыты
  только каналы `link`, и Linked machine не видит Project-ов этой Machine. Выключение сразу отписывает
  соединение от hub-ов (общих наблюдателей файлов, которые шлют изменения подписчикам), Terminal и
  Session — и только: то, что Linked machine запустила раньше (Session-ы, Autopilot, очередь `agent.send`),
  продолжает работать, не останавливается и не ставится на паузу (решение владельца 2026-10-12, «Итог»
  Ticket-а 08).
  - **Уровень у каждой Linked machine** (Ticket 18, ADR-0066): Off, Read only, Full access; у новой
    связи — Off. Переключатель остаётся и выключает доступ всем: пока он выключен, уровень каждой
    Linked machine — Off. Read only открывает только каналы `read`: вызов канала `write` получает
    отказ «Linked machines can only view the Projects of <Machine>: access is read-only» до разбора
    входа, handler не запускается. В «чтение» входят транскрипты, события Session и уведомления;
    вывод Terminal — нет. Read only всё равно означает доверие: транскрипт может показать секрет.
  - Смена уровня заменяет клиента соединения: подписки снимаются, экран подписывается заново.
    Понижение уровня не останавливает запущенное раньше — правило ADR-0060.
  - Linked machine узнаёт свой уровень из служебного сообщения `projects-access`, а не по тексту
    отказа. Скрыть действия записи на её экране — Ticket 25.
- **Реестр клиентов** (Ticket 03, `src/main/clients.ts`). Окно Electron и соединение Linked
  machine-а — одинаковые получатели событий: `id`, `send`, `isDestroyed`, событие `destroyed`.
  Рассылка «всем окнам» и подписки hub-ов идут по реестру, а не по `BrowserWindow.getAllWindows()`.
- **Что живёт на машине Project-а** ([ADR-0053](../../docs/adr/0053-several-screens-on-one-project.md)).
  Layout, Card-ы и их данные, Session-ы, Terminal, Autopilot, Gate.
  - Session из канала `agent.start` принадлежит приложению, а не окну. Закрытие окна и обрыв связи
    её не закрывают (Ticket 04).
  - Terminal шлёт вывод всем подписчикам. Размер pty (псевдотерминала, в котором работает shell)
    задаёт экран, где последним печатали или кликнули (Ticket 05).
- **Что своё у экрана** (ADR-0053, пункт 2). Экран — окно worfy с Canvas Project-а.
  - Камера Canvas уходит из `layout.json` в `viewports.json` папки данных машины экрана (Ticket 06).
  - ⌘Z помнит только свои жесты. Шаг, чей Node с тех пор правил другой экран, пропускается с
    подсказкой (Ticket 07). Для этого экран шлёт свой id в `layout.apply`.
- **Окно на Linked machine-е** (Ticket 09). Окно показывает Project-ы одной Machine. Переход на
  Project Linked machine-а перезагружает renderer. Так два Project-а с одним `projectId` — одна папка
  в двух worfy — не смешиваются в store renderer-а. Маршрут вызова выводится из пометки канала в
  `windowBridge()` (`src/renderer/ipc.ts:41`): `project` и `desktop` — на Machine окна через свой
  main, `local` и `link` — на свою машину. Токен, сертификат и адрес Linked machine-а в renderer не
  попадают.
- **Системные действия — на машине экрана** (ADR-0053, пункт 6).
  - Папку на Linked machine-е выбирают просмотром её файлов внутри worfy: канал `projects.browse`
    (Ticket 11).
  - «+» у вложения открывает диалог своей машины. Байты идут тем же путём, что drag-drop: base64 до
    20 МБ (Ticket 12).
  - Ссылка открывается там, где кликнули (Ticket 12).
  - Подтверждение Card показывает экран, где Card открыта: канал `cardApi.ask` делится на три
    (Ticket 10).
  - Файлы Card Linked machine-а отдаёт свой main по адресу
    `worfy-card://<card>.<project label>.<machine label>/…`. У такой Card свой origin (Ticket 10).
- **Уведомления** (Ticket 13). Машина Project-а решает, о чём уведомить, и шлёт заметку подключённым
  Linked machine-ам. Показывает каждая машина по своим правилам: фокус своего окна, «не беспокоить»
  своей ОС.
- **Сон** (Ticket 14). Пока подключена хотя бы одна Linked machine и включён доступ, машина держит
  `powerSaveBlocker` типа `prevent-app-suspension`. Второй переключатель это выключает. Перед сном
  машина шлёт «засыпаю», и вторая показывает её как «спит», а не «недоступна».
- **Один Autopilot на Epic и origin** (Ticket 15). Перед стартом Autopilot спрашивает Linked machine-ы
  в сети, нет ли у них прогона того же Epic-а с тем же адресом remote `origin` (нормализованным).
  Есть — отказ с именем Machine. Обход — только явное «Start anyway».

## Этапы

1. **Связь двух Machine** — 01, 02.
   - 01: Machine, сервер связи, pairing по коду, запомненный сертификат, отзыв на уровне сервиса,
     канал `link.ping`, стенд test-ов `test/contract/link-bench.ts`.
   - 02: окно «Link a machine» (Bonjour или адрес, код на экране), секция Linked machine-ов в боковой
     панели, переподключение, отзыв с любой стороны, переключатель доступа, helper двух связанных
     worfy в e2e.
2. **Несколько экранов одной машины** — 03–07. Проверяются на двух окнах одного worfy, без сети.
   - 03: реестр клиентов вместо окон; helper второго окна в e2e.
   - 04: Session из `agent.start` не зависит от окна.
   - 05: Terminal на несколько экранов; замер вывода; склейка кусков вывода — только по замеру.
   - 06: камера Canvas своя у экрана.
   - 07: ⌘Z — только свои правки.
3. **Project-ы по сети** — 08, 09.
   - 08: пометка доступа у каждого канала, фильтр каналов на соединении, переключатель доступа.
   - 09: Project-ы Linked machine-ов в боковой панели по Machine; окно на Project-е Linked machine-а;
     маршрут вызовов.
4. **Действия на машине экрана** — 10, 11, 12.
   - 10: Card Linked machine-а через свой `worfy-card://`; подтверждение там, где Card открыта.
   - 11: «Add Project» на Linked machine — выбор Machine, просмотр её папок.
   - 12: «+» у вложения и ссылки — на машине экрана; «открыть в редакторе» и Minimap — по ответам
     владельца.
5. **Уведомления, сон, Autopilot** — 13, 14, 15.
   - 13: уведомления на подключённых Linked machine-ах.
   - 14: машина не засыпает, пока подключены; состояние «спит».
   - 15: второй Autopilot на тот же Epic и origin не стартует.
6. **Приёмка** — 16: пять пунктов «Готово, когда» на одном Mac, потом на паре Mac + Windows.
7. **Вне локальной сети через Tailscale** (ADR-0070, после очереди `worfy-windows`) — 27–31.
   - 27: настройка «Связь через Tailscale» и адреса Tailscale только на интерфейсе Tailscale.
   - 28: не больше 10 неудачных pairing за час на Machine (и в LAN тоже).
   - 29: ввод руками имени MagicDNS или адреса; имена MagicDNS в проверке `Host`. Ждёт 27.
   - 30: список машин из Tailscale CLI. Ждёт 29.
   - 31: e2e и приёмка с владельцем через Tailscale. Ждёт 27, 28, 29, 36, 37.
   - 36, 37 (баг владельца 2026-10-26: после смены адреса Mac связь не восстановилась, убрать машину было
     нечем) — сразу после мержа 29, до 30. 36: таймаут TCP и TLS, набор сразу после сна, смены сети и по
     `link.reconnect`, объявление Bonjour заново, запасные имена `.local` и MagicDNS, `link.setAddress`, журнал
     `[link]` в файле; платформенный PR. Ждёт 29. 37: «Reconnect», «Remove», «Change address…» в строке без
     связи, «Remove» в Settings и Command palette, «Revoke» → «Remove». Ждёт 36.
8. **Первое открытие Project-а Linked machine-а** — 33 (отзыв владельца 2026-10-19 на ручной проверке
   связи Mac и Windows-ПК, «Итог» 16): замер первого открытия, строка хода загрузки поверх Canvas,
   дешёвые правки по замеру. 15–20 с загрузки владелец принял; цель — видимый ход загрузки и сдвиг
   Canvas без зависаний. Блокеров нет; приёмку 16 не держит.

## Решения владельца

Session проектирования 2026-10-07: вопросы Q1–Q25 в двух раундах, все рекомендации приняты. Номер
вопроса — как в той Session. Ticket-ы ссылаются на эти номера и на ADR.

- **Machine и связь** — ADR-0052 (Q4, Q7, Q9, Q11). Machine — компьютер с worfy. У Project-а ровно одна
  Machine; один репозиторий на двух Machine — два Project-а. Linked machine — связанная Machine, связь
  двусторонняя. host и client — роли соединения, а не виды устройств и не термины. «Link a machine»:
  Bonjour или адрес, 6-значный код на экране второй машины, TLS с запомненным сертификатом, токен
  устройства, отзыв с любой стороны. Доступ «Linked machines can work with my Projects» по умолчанию
  выключен. Только LAN, проверка Origin и Host до upgrade. Токены и коды не пишутся в логи.
  Отвергнуты: свой удостоверяющий центр (mkcert), HTTP без TLS, доступ, включённый по умолчанию.
  Доступ из интернета отложен. Пункт «только LAN» заменён [ADR-0070](../../docs/adr/0070-worfy-link-outside-the-lan-through-an-overlay-network.md) (решения владельца 2026-10-18): связь
  через Tailscale владельца, отдельная настройка, Ticket-ы 27–31.
- **Список Project-ов и «Add Project»** — ADR-0052 (Q10). Слева — Project-ы всех Linked machine-ов,
  сгруппированные по Machine, с состоянием «в сети», «спит», «недоступна». «Add Project» — сначала
  Machine, потом папка просмотром её файлов внутри worfy. Нативный диалог для Linked machine-а
  отвергнут: он показывает диски своей машины.
- **Общее и своё у экрана** — ADR-0053 (Q2, Q15). Обе машины работают одновременно. Общее состояние
  приходит на все экраны вживую; правки Layout — в порядке прихода, последняя побеждает. Своё у
  экрана — камера Canvas на каждый Project (уходит из общего Layout), выделение, ⌘Z, панели. ⌘Z
  отменяет только свои правки; если тот же Node потом правил другой экран, шаг пропускается с
  подсказкой.
- **Что можно с другой машины** — ADR-0053 (Q3, Q14). Всё, кроме действий, которым нужен рабочий стол
  машины Project-а. Session, запущенная с другой машины, живёт на машине Project-а и не закрывается с
  окном. Размер Terminal — у экрана, где последним печатали или кликнули. Системные диалоги — в UI
  машины, откуда вызваны: просмотр папок машины Project-а, вложение со своей машины по сети,
  подтверждение Card — где она открыта.
- **Уведомления** — ADR-0053 (Q6, Q16). Их показывают машина Project-а и подключённые к нему Linked
  machine-ы — в своём worfy, не в браузере. «Не беспокоить» — на каждой машине своё.
- **Сон** — ADR-0053 (Q5, Q17). Пока подключена Linked machine, машина Project-а не засыпает; это
  выключается переключателем. Уснувшая машина — статус «спит». Wake-on-LAN — позже.
- **Autopilot** — ADR-0053 (Q13). Второй Autopilot на тот же Epic с тем же `origin` на другой машине не
  стартует («уже идёт на Mac»). Обход — только явный.
- **Полный порт и отвергнутые клиенты** — ADR-0054 (Q1, Q18, Q20–Q22, Q24). worfy на Windows — то же
  приложение, с агентами; его делает Epic worfy-windows. Браузерный клиент и тонкий Electron-клиент
  отвергнуты (Q1). Отсюда для worfy-link: код связи не зависит от ОС. Сертификат и Bonjour — на
  библиотеках без нативной сборки и без внешних программ вроде `openssl` (Ticket-ы 01, 02). Пути
  Linked machine-а renderer не разбирает (Ticket 11).
- **Скрипты Harness на Node** — ADR-0055 (Q19). worfy-link Harness не меняет.
- **Две Session-ы и проверки** — ADR-0056 (Q12, Q23, Q25). Windows-раннера на PR нет. gate full на
  Windows-ПК владельца — перед мержем платформенных PR; ручной job «Windows» в CI. worfy-link ведёт
  Session на Mac, worfy-windows — Session на Windows-ПК. Они общаются через репозиторий; перед Wave
  проверяют открытые PR второго Epic-а на общие файлы; мерж в main — по очереди.
- **Порядок** (Q8, Q12). Спроектировано сейчас, делается после E3 — Epic-а worfy-harness (Harness как
  plugin Claude Code). Идёт параллельно с worfy-windows. Связь сначала проверяется на одном Mac:
  dev-сборка и Stable copy. E4 (подпись, нотаризация, внешние пользователи) — после обоих Epic-ов.
- **Epic** — имя `worfy-link` (Linked machines); «Готово, когда» — пять пунктов раздела «Цель».

## Не в этом Epic-е

- **Проброс порта, свой relay-сервер, библиотека обхода NAT** — отвергнуты ([ADR-0070](../../docs/adr/0070-worfy-link-outside-the-lan-through-an-overlay-network.md)). Вне локальной сети
  связь идёт только через overlay-сеть владельца (Tailscale) — Ticket-ы 27–31, после очереди
  `worfy-windows`.
- **Wake-on-LAN** — позже (Q17).
- **Браузерный клиент и тонкий Electron-клиент** — отвергнуты (Q1; ADR-0052, ADR-0054).
- **worfy на Windows** — Epic worfy-windows: Terminal на PowerShell, `app.setAppUserModelId` для
  уведомлений Windows, установщик. worfy-link проверяет пару Mac + Windows в Ticket-е 16, когда worfy
  на Windows уже есть.
- **Подпись приложения** — E4. С ad-hoc подписью включённый firewall macOS спрашивает «Accept
  incoming connections?» после каждой пересборки (ADR-0052, последствия).
- **То, чего владелец не решал:** переименование Machine (Ticket 02); пункт меню «New Window»
  (Ticket-ы 03 и 06 спрашивают владельца, только если helper второго окна не встанет); признак «кто
  написал» в Session (Ticket 04); защита от ручного «Run wave» на двух машинах (Ticket 15).
- **Общий для экранов флаг «Stopping…»** — Ticket 18 Epic-а worfy-week (graceful Stop).
- **Проверка базовой ревизии в операциях Layout** — побеждает последняя правка, как сейчас (ADR-0053,
  пункт 1; Ticket 07).
- **Смена Machine у Project-а** — такой операции нет (Q9).
- **Чтение файла Project-а Linked machine-а внутри worfy** (вариант «б» Ticket-а 12) — отдельным
  Ticket-ом, если владелец его выберет.

## Риски и открытые технические вопросы

1. **Через сеть исполняется код.** С Linked machine-а запускаются Terminal и агенты. Защита держится
   на четырёх вещах: доступ выключен по умолчанию, одноразовый код, TLS с запомненным сертификатом,
   токен устройства (ADR-0052, последствия). Ошибка в любой открывает машину Project-а. Ticket 01
   проверяет test-ами посредника в сети (TLS-прокси со своим сертификатом), отказы до upgrade и то,
   что чужому серверу токен не уходит.
2. **Протокол pairing.** У кода 10^6 вариантов. Простой HMAC от кода посредник подберёт перебором по
   одному перехваченному сообщению. Нужен протокол, где у посредника одна попытка на код, — например
   PAKE. Проверенную библиотеку выбирает Ticket 01. Своя схема — только по опубликованному протоколу.
3. **Где хранить секреты** — файл с правами 0600 или `safeStorage` Electron (Keychain на macOS).
   Спросит ли Keychain доступ после каждого обновления Stable copy с ad-hoc подписью — не проверено.
   Проверяет Ticket 01 до выбора.
4. **Запрос Local Network на macOS 15+.** Его вызывает свой Bonjour-сервис (Apple TN3179 —
   техническая заметка о разрешении Local Network). Вызывает ли его что-то ещё, например исходящее
   соединение в LAN, и как ведёт себя ad-hoc подписанная сборка — не проверено (Ticket 02). e2e идут с
   выключенным Bonjour: запрос на экране остановил бы прогон. Найдёт ли Windows сервис worfy через
   mDNS — не проверено. Адрес, введённый руками, работает без обнаружения.
5. **Два окна одного worfy никто не запускал.** helper второго окна (Ticket 03) не проверен: пройдут
   ли вызовы второго окна проверку «вызов из кадра worfy» (`isAppUrl`, `src/main/index.ts:79-80`). Не
   выйдет — другой способ. Пункт меню «New Window» — только с ответа владельца.
6. **Нагрузка вывода Terminal.** Сейчас каждый кусок вывода pty — отдельное событие, без склейки; по
   сети это не мерили. Ticket 05 мерит на двух окнах и склеивает куски, только если замер покажет
   нужду. Замер по LAN — в Ticket-е 16.
7. **Один `projectId` на двух машинах.** Id Project-а — имя папки и хэш пути, поэтому одна папка в
   двух worfy даёт одинаковый id. Ticket 09 перезагружает окно при переходе на другую Machine.
   Ticket 10 даёт Card Linked machine-а свой origin.
8. **Решения владельца при claim и при ревью.** Ticket делает по ответу:
   - 11 — что видно в просмотре папок Linked machine-а: весь диск или домашняя папка;
   - 12 — «открыть в редакторе» для Project-а Linked machine-а; Minimap своё у экрана или общее;
   - 13 — что значит «Linked machine подключена к Project-у»;
   - 14 — держать машину бодрствующей только при включённом доступе;
   - 15 — недоступная Linked machine, выключенный доступ, Project без `origin`.

   При ревью владелец подтверждает толкования: 07 — нажатие ⌘Z на устаревшем шаге только показывает
   подсказку; 09 — одно окно показывает одну Machine, переход на другую — перезагрузка.
9. **Сообщение «засыпаю» может не успеть** уйти до сна. Тогда вторая машина покажет «недоступна».
   Ticket 14 на одном Mac проверяет только порядок событий. Проверка по сети — Ticket 16, на паре
   Mac + Windows.
10. **Файлы, которые Ticket-ы допишут при claim.** Имена файлов связи — предложение Ticket-ов 01 и 02,
    итог — в их «Итог». Ticket-ы 13 и 15 дописывают файл служебных сообщений из «Итог» Ticket-а 01.
    Ticket 14 дописывает файлы Ticket-а 02: состояние Linked machine-ов, их список в UI, хранение
    переключателя. Ticket 11 строится на файлах Ticket-а 24 Epic-а worfy-harness (подключение
    Project-а по шагам). От этого план Wave-ов может сдвинуться.
11. **Новый доменный файл в Wave 3.** Ticket 06 заводит `src/shared/ipc/viewport.ts`, а Ticket 08 в
    той же Wave делает пометку канала обязательной. Кто вливается вторым, ставит пометку `local`
    каналам `viewport.*`: без неё сборка не пройдёт.
12. **Stable copy для ручных проверок.** Ручные проверки на dev-сборке и Stable copy (Ticket-ы 02, 14,
    16) требуют Stable copy с кодом связи. Её ставят заново (`pnpm install:stable`) после мержа нужных
    Ticket-ов и не во время прогона Autopilot. В прогоне Stable copy не пересобирается
    ([ADR-0047](../../docs/adr/0047-harness-lessons-by-pr-early-owner-switch.md) — развитие Harness и
    переход машины владельца).
13. **Платформенный PR ждёт Windows-ПК** (ADR-0056, пункт 2). PR, который трогает код с ветками по
    платформе, скрипты Harness или упаковку, мержится после gate full на Windows-ПК владельца. Из
    worfy-link таким может стать Ticket 02, если ему понадобятся ключи Info.plist в
    `electron-builder.yml`.
14. **Уведомления dev-сборки** из `pnpm dev` могут прийти от «Electron» или не прийти совсем
    (`src/main/notify.ts:18-19`). Ручная проверка уведомлений в Ticket-е 16 это учитывает.
15. **Ticket 18 Epic-а worfy-week** (graceful Stop и Force stop в меню «⋯») открыт и правит те же
    файлы Autopilot, что Ticket 15. Если его PR открыт при claim Ticket-а 15, пересечения сверяются до
    начала.
16. **Ticket 16 и Epic worfy-windows.** `Blocked by` держит только Ticket-ы своего Epic-а. Пройдя
    проверки на Mac, Ticket 16 уходит в `blocked` с причиной «ждёт Epic worfy-windows». После приёмки
    того Epic-а — проверки на паре Mac + Windows.
17. **План Wave-ов — прогноз.** Wave, которую берут в работу, вычисляется заново в момент запуска
    (CONTEXT.md, термин Wave).

## Соглашения для Ticket-ов этого Epic-а

Как в [worfy-week](../worfy-week/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а»: сначала
падающий test, виды test-ов, только чтение чужих файлов, ручные пункты «(вручную)», снимки UI в двух
темах, Autopilot над worfy — только на Stable copy. Отличия:

- **Начало** — после закрытия Epic-а worfy-harness (E3). Раньше Ticket-ы не берутся.
- **Кто ведёт** — Session на Mac владельца. Epic worfy-windows ведёт другая Session, на Windows-ПК
  владельца. Прямого канала между ними нет. Всё, что нужно знать о второй, Session читает из
  репозитория: Status Ticket-ов, открытые PR и их файлы, main, `HANDOFF.md` (ADR-0056, пункт 4).
- **Ветки** — `worfy-link/<NN>`; worktree — `.claude/worktrees/<NN>`.
- **Перед каждой Wave — PR с меткой `needs-mac-gate`** (Q30–Q33, решения владельца 2026-10-08;
  дополняют ADR-0056). Session на Mac проходит открытые PR с этой меткой по правилу
  [worfy-windows](../worfy-windows/spec.md), раздел «Соглашения для Ticket-ов этого Epic-а», пункт
  «Метка needs-mac-gate». Проходит очередь командой Harness `/worfy:gate-queue` (Q32): её запускает
  Autopilot на Mac перед каждой Wave и когда больше нечего делать, вручную — действие «Process gate
  queue» в worfy. До Ticket-а 17 `worfy-windows` (команда, действие и уведомление) — вручную, по
  шагам правила. По одному: rebase на свежий main, `GATE_SCOPE=all` gate full на Mac под замком
  `/tmp/worfy-e2e.lock` и команды раздела «Mac checks» из описания PR (Q33). Потом отчёт в PR:
  вердикт, строка `[gate]`, коды выхода команд «Mac checks»; без отчёта мержа нет. Зелёный, CI на PR
  после push зелёный и отчёт в PR — мерж (squash) и снятие метки. Красный — отчёт с причиной, метка
  остаётся. Конфликт при rebase — тоже красный, кроме конфликта только в `HANDOFF.md`: его решает
  Session, которая мержит. Ticket-ы `worfy-windows` Session на Mac не берёт и их Status не меняет:
  Ticket закрывает Session на Windows. Проход идёт до сверки файлов открытых PR `worfy-windows`
  (следующий пункт), и влитый PR в сверку уже не попадает. gate full на Windows после rebase до
  мержа не повторяется (Q31): Session на Windows гоняет gate full на свежем main в начале каждой
  своей Wave и, если он красный, первым делом чинит main.
- **Перед каждой Wave — открытые PR Epic-а worfy-windows** (ADR-0056, пункт 5). Их файлы сравниваются с
  «Где в коде» Ticket-ов Wave тем же правилом, что внутри Wave. Ticket с общим файлом ждёт мержа того
  PR. Пересечение и отложенный Ticket называются в отчёте Wave.
- **Мерж в main — по очереди** (ADR-0056, пункт 6). За раз вливается один PR. Второй перед мержем
  обновляется от свежего main и проверяется заново. Платформенный PR (риск 13) — ещё и gate full на
  Windows-ПК владельца.
- **ADR.** Номер ADR Ticket-у этого Epic-а выдаёт Orchestrator в момент взятия: следующий свободный, по одному
  решению на файл. Принятые ADR не правятся: уточнение — новым ADR, который говорит, что он уточняет.
- **Проверка связи — два worfy на одном Mac.** Machine привязана к папке данных, поэтому dev-сборка
  и Stable copy — две Machine.
  - contract test-ы — стенд `test/contract/link-bench.ts` Ticket-а 01: несколько сервисов связи над
    временными папками данных в одном процессе vitest, на `127.0.0.1`;
  - e2e — два `launchApp` с разными папками данных, связанные helper-ом Ticket-а 02 по адресу
    `127.0.0.1:<порт>`, Bonjour выключен;
  - вручную — dev-сборка и Stable copy (риск 12);
  - пара Mac + Windows — только в Ticket-е 16.
- **Test-ы связи идут и на Linux** (CI): только `127.0.0.1`, без API Electron. Хранилище секретов в
  test-ах подменяется.
- **Токены и код связи** не попадают в `console.*`, тексты ошибок, ответы IPC и журналы worfy.
  Test-ы связи перехватывают `console` (`link-bench.ts`) и ищут в перехваченном токены и код.
- **Новый канал IPC — с пометкой доступа** (`link`, `project`, `desktop`, `local`). После Ticket-а 08
  канал без пометки не собирается. Каналы Ticket-ов, влитых до 08, помечает Ticket 08.
- **helper-ы e2e.** Второе окно одного worfy — Ticket 03, два связанных worfy — Ticket 02. Остальные
  Ticket-ы `test/e2e/helpers.ts` не правят. e2e двух worfy — каждый в своём spec-файле
  (`test/e2e/linked-*.spec.ts`), чтобы Ticket-ы одной Wave не делили файлов.
  `test/e2e/linked-machines.spec.ts` правят только Ticket-ы 02, 09 и 16.
- **Вопросы владельцу** (риск 8) задаются при claim; Ticket делает по ответу.
- **CI** — только Linux: lint, typecheck, unit и contract test-ы. e2e и `.app` проверяются локально
  перед мержем: `GATE_SCOPE=all gate.sh full` на ветке (команда — `rules.md` Profile-а worfy).
- **Системные запросы macOS** (Local Network, Keychain, firewall) и вход в аккаунты — за владельцем.

## Волны

Wave — Ticket-ы, которые можно брать параллельно: все блокеры закрыты, общих файлов в «Где в коде»
нет. Таблица — план. Wave, которую берут в работу, вычисляется заново в момент запуска (CONTEXT.md,
термин Wave). Заголовок раздела и шапка таблицы остаются русскими: это формат, который читает skill
`epic-wave`.

| Тикет | Файлы из «Где в коде» | Волна |
| --- | --- | --- |
| 01 | `src/main/link/identity.ts`, `src/main/link/secrets.ts`, `src/main/link/store.ts`, `src/main/link/checks.ts`, `src/main/link/pairing.ts`, `src/main/link/server.ts`, `src/main/link/client.ts`, `src/main/link/messages.ts`, `src/main/link/ipc-adapter.ts`, `src/main/link/service.ts`, `src/shared/ipc/link.ts`, `src/main/ipc/link.ts`, `src/main/ipc/index.ts`, `src/main/index.ts`, `package.json`, `pnpm-lock.yaml`, `test/contract/link-bench.ts`, `test/contract/link-pairing.test.ts`, `test/contract/link-server.test.ts`, `test/unit/link-checks.test.ts`, `test/contract/main-ipc-wiring.test.ts` | 1 |
| 02 | `src/shared/ipc/link.ts`, `src/main/ipc/link.ts`, `src/main/link/service.ts`, `src/main/link/discovery.ts`, `src/main/link/connections.ts`, `src/main/link/settings.ts`, `src/renderer/machines/useMachines.ts`, `src/renderer/machines/LinkMachineDialog.tsx`, `src/renderer/shell/sidebar/MachinesSection.tsx`, `package.json`, `pnpm-lock.yaml`, `electron-builder.yml`, `test/unit/link-discovery.test.ts`, `test/contract/link-connections.test.ts`, `test/e2e/linked-machines.spec.ts`, `test/e2e/helpers.ts` | 2 |
| 03 | `src/main/clients.ts`, `src/main/broadcast.ts`, `src/main/ipc/layout.ts`, `src/main/ipc/view.ts`, `src/main/ipc/cards.ts`, `src/main/ipc/projects.ts`, `src/main/ipc/trash.ts`, `src/main/ipc/actions.ts`, `src/main/ipc/workflow.ts`, `src/main/ipc/docs.ts`, `src/main/ipc/claude-home.ts`, `src/main/ipc/bindings.ts`, `src/main/ipc/limits.ts`, `src/main/ipc/notify.ts`, `src/main/notify-pending.ts`, `src/main/workflow/watch.ts`, `test/contract/clients.test.ts`, `test/unit/notify.test.ts`, `test/e2e/two-windows.spec.ts`, `test/e2e/helpers.ts` | 1 |
| 04 | `src/main/ipc/agent.ts`, `src/main/agent/app-orchestrators.ts`, `test/contract/agent-session.test.ts`, `test/e2e/session-two-windows.spec.ts` | 2 |
| 05 | `src/main/ipc/terminal.ts`, `src/main/terminal/pty.ts`, `src/shared/ipc/terminal.ts`, `src/renderer/canvas/nodes/TerminalNode.tsx`, `test/contract/terminal.test.ts`, `test/e2e/terminal.spec.ts` | 2 |
| 06 | `src/shared/layout/types.ts`, `src/main/layout/store.ts`, `src/main/layout/viewports.ts`, `src/shared/ipc/viewport.ts`, `src/main/ipc/viewport.ts`, `src/renderer/canvas/Canvas.tsx`, `src/renderer/canvas/history.ts`, `test/contract/viewport-store.test.ts`, `test/contract/layout-store.test.ts`, `test/unit/history.test.ts`, `test/e2e/helpers.ts`, `test/e2e/canvas-layout.spec.ts`, `test/e2e/card-drag.spec.ts` | 3 |
| 07 | `src/renderer/canvas/history.ts`, `src/renderer/canvas/screen.ts`, `src/renderer/canvas/useLayout.ts`, `src/renderer/canvas/Canvas.tsx`, `src/renderer/canvas/overlays/UndoSkipped.tsx`, `src/shared/ipc/layout.ts`, `src/shared/ipc/trash.ts`, `src/main/layout/store.ts`, `src/main/ipc/layout.ts`, `src/main/layout/trash.ts`, `src/main/ipc/trash.ts`, `test/unit/history.test.ts`, `test/contract/layout-store.test.ts`, `test/e2e/trash-undo.spec.ts` | 2 |
| 08 | `src/shared/ipc/channels.ts`, `src/shared/ipc/actions.ts`, `src/shared/ipc/agent.ts`, `src/shared/ipc/app.ts`, `src/shared/ipc/autopilot.ts`, `src/shared/ipc/bindings.ts`, `src/shared/ipc/card-api.ts`, `src/shared/ipc/cards.ts`, `src/shared/ipc/checks.ts`, `src/shared/ipc/claude-home.ts`, `src/shared/ipc/docs.ts`, `src/shared/ipc/layout.ts`, `src/shared/ipc/limits.ts`, `src/shared/ipc/notify.ts`, `src/shared/ipc/orchestrator.ts`, `src/shared/ipc/projects.ts`, `src/shared/ipc/sessions.ts`, `src/shared/ipc/shell.ts`, `src/shared/ipc/terminal.ts`, `src/shared/ipc/trash.ts`, `src/shared/ipc/view.ts`, `src/shared/ipc/workflow.ts`, `src/shared/ipc/link.ts`, `src/main/ipc/index.ts`, `src/main/link/ipc-adapter.ts`, `src/main/link/service.ts`, `test/contract/ipc-sample/shared/sample.ts`, `test/contract/ipc.test.ts`, `test/unit/link-access.test.ts`, `test/contract/link-access.test.ts` | 3 |
| 09 | `src/renderer/ipc.ts`, `src/renderer/projects/useProjects.ts`, `src/renderer/shell/sidebar/ProjectsSection.tsx`, `src/renderer/main.tsx`, `src/main/window.ts`, `src/main/link/remote-calls.ts`, `src/main/ipc/linked.ts`, `src/shared/ipc/linked.ts`, `src/shared/ipc/projects.ts`, `src/main/ipc/projects.ts`, `src/main/agent/app-orchestrators.ts`, `src/main/ipc/docs.ts`, `test/contract/ipc-renderer.test.tsx`, `test/unit/use-projects.test.tsx`, `test/e2e/linked-machines.spec.ts` | 4 |
| 10 | `src/main/cards/protocol.ts`, `src/main/cards/remote.ts`, `src/main/cards/ask.ts`, `src/main/ipc/card-api.ts`, `src/main/ipc/cards.ts`, `src/shared/ipc/card-api.ts`, `src/shared/ipc/cards.ts`, `src/shared/cards/bridge.ts`, `src/renderer/canvas/nodes/CardNode.tsx`, `src/renderer/canvas/overlays/CardBridge.tsx`, `test/contract/card-protocol.test.ts`, `test/contract/card-bridge.test.ts`, `test/contract/card-api.test.ts`, `test/e2e/card-api.spec.ts`, `test/e2e/linked-cards.spec.ts` | 5 |
| 11 | `src/shared/ipc/projects.ts`, `src/main/ipc/projects.ts`, `src/main/projects/store.ts`, `src/main/projects/browse.ts`, `src/main/projects/connect.ts`, `src/renderer/projects/ConnectProject.tsx`, `src/renderer/projects/FolderBrowser.tsx`, `src/renderer/shell/sidebar/ProjectsSection.tsx`, `test/contract/projects.test.ts`, `test/unit/folder-browser.test.tsx`, `test/unit/add-project-machine.test.tsx`, `test/e2e/linked-add-project.spec.ts` | 5 |
| 12 | `src/renderer/session/MessageInput.tsx`, `src/shared/ipc/shell.ts`, `src/renderer/markdown/Markdown.tsx`, `src/renderer/canvas/nodes/TicketNode.tsx`, `src/renderer/shell/sidebar/AdrSection.tsx`, `test/unit/message-input-attach.test.tsx`, `test/unit/markdown.test.tsx`, `test/contract/shell.test.ts`, `test/e2e/linked-system-actions.spec.ts` | 5 |
| 13 | `src/main/notify.ts`, `src/main/notify-pending.ts`, `src/main/ipc/notify.ts`, `src/shared/ipc/notify.ts`, `src/main/index.ts`, `src/main/link/notes.ts`, `src/renderer/session/notification-target.ts`, `src/renderer/canvas/overlays/NotificationTarget.tsx`, `test/unit/notify.test.ts`, `test/unit/link-notify.test.ts`, `test/unit/permission-card.test.tsx`, `test/e2e/linked-notify.spec.ts` | 5 |
| 14 | `src/main/autopilot/power.ts`, `src/main/link/keep-awake.ts`, `src/main/link/sleep-notice.ts`, `src/shared/ipc/link.ts`, `test/unit/link-power.test.ts`, `test/e2e/linked-sleep.spec.ts` | 4 |
| 15 | `src/main/autopilot/run.ts`, `src/main/autopilot/origin.ts`, `src/main/autopilot/journal.ts`, `src/shared/autopilot/journal.ts`, `src/main/ipc/autopilot.ts`, `src/shared/ipc/autopilot.ts`, `src/main/link/autopilot-runs.ts`, `src/renderer/canvas/actions/AutopilotAction.tsx`, `test/unit/autopilot-origin.test.ts`, `test/unit/autopilot-run.test.ts`, `test/e2e/linked-autopilot.spec.ts` | 4 |
| 16 | `test/e2e/linked-machines.spec.ts`, `.scratch/worfy-link/spec.md` | 6 |
| 38 | `src/main/diagnostics/closed-stdio.ts`, `src/main/index.ts`, `test/unit/closed-stdio.test.ts`, `test/contract/stdout-epipe.test.ts` | вне Wave (находка ПК 2026-10-31) |
| 39 | `src/main/link/checks.ts`, `src/main/link/server.ts`, `src/main/link/tailscale.ts`, `src/main/link/service.ts`, `test/contract/link-server.test.ts`, `test/contract/link-by-name.test.ts`, `test/unit/link-magicdns.test.ts` | вне Wave (находка приёмки 31) |

Правило плана. Ticket стоит в первой Wave, где закрыты все его блокеры (`Blocked by`). Если у двух
Ticket-ов одной Wave общий файл, Ticket с большим номером уходит в следующую Wave.

- **Wave 1 — 01 и 03.** Блокеров нет. Общих файлов нет: 01 — новая папка `src/main/link/`,
  `src/main/index.ts` и `src/main/ipc/index.ts`; 03 — рассылка и подписки в `src/main/ipc/` и helper
  второго окна в `test/e2e/helpers.ts`.
- **Wave 2 — 02, 04, 05 и 07.** 02 ждёт 01; 04, 05 и 07 — 03. Общих файлов нет: 02 — UI связи и
  helper двух связанных worfy; 04 — `src/main/ipc/agent.ts`; 05 — Terminal; 07 — история ⌘Z, Layout и
  корзина.
- **Wave 3 — 06 и 08.** 06 без блокеров, сдвинут (ниже). 08 ждёт 01, 02 и 03. Общих файлов нет: 06 —
  камера, `src/main/layout/store.ts` и новый домен `viewport`; 08 — пометки в доменных файлах
  `src/shared/ipc/` и фильтр каналов в `src/main/ipc/index.ts`. Про пометку каналов `viewport.*` —
  риск 11.
- **Wave 4 — 09, 14 и 15.** 09 и 15 ждут 08; 14 ждёт 02 (по блокерам — Wave 3, сдвинут). Общих файлов
  нет: 09 — мост renderer, боковая панель и свой домен `linked`; 14 — `src/main/autopilot/power.ts` и
  `src/shared/ipc/link.ts`; 15 — Autopilot.
- **Wave 5 — 10, 11, 12 и 13.** Все ждут 09. Общих файлов нет: 10 — Card; 11 — `projects.browse`,
  `ProjectStore` и диалог подключения; 12 — `MessageInput.tsx`, Markdown и `src/shared/ipc/shell.ts`;
  13 — уведомления и `src/main/index.ts`. Пометки каналов стоят в доменных файлах, у каждого Ticket-а
  свои; e2e — в своих spec-файлах.
- **Wave 6 — 16, один.** Ждёт все остальные Ticket-ы. Отмечает пункты «Готово, когда» в этом файле.

Сдвиги из-за общих файлов:

- **06: Wave 1 → 3.** Wave 1 → 2: с 03 общий `test/e2e/helpers.ts`. Wave 2 → 3: с 02 тот же файл.
  Отсюда 07 (Wave 2) идёт раньше 06, хотя у них общие `src/renderer/canvas/history.ts`,
  `src/renderer/canvas/Canvas.tsx`, `src/main/layout/store.ts`, `test/unit/history.test.ts` и
  `test/contract/layout-store.test.ts`: 06 начинается поверх влитого 07. helper второго окна к Wave 3
  уже влит Ticket-ом 03, и 06 берёт его, а не пишет свой. Блокеров у 06 нет: если `helpers.ts` не
  занят, вычисление Wave в момент запуска может взять 06 раньше — это допустимо.
- **14: Wave 3 → 4.** С 08 общий `src/shared/ipc/link.ts`.

Таблица собрана скриптом. Файлы — текст в обратных кавычках пунктов списка «Где в коде», без пометки
«(новый)». Файлы, которые Ticket-ы допишут при claim (риск 10), в таблицу не вошли. Пересечения —
правилом `filesOverlap` (`src/shared/workflow/waves.ts:145`): совпадение пути; папка с `/` на конце
пересекается с каждым файлом в ней. Внутри каждой Wave плана общих файлов нет, каждый блокер — в Wave
раньше.
