# Собственное состояние worfy шире Layout и Card-ов

Дата: 2026-10-05. Статус: принят.

ADR 0002 называет собственным состоянием worfy только Layout и Card-ы. При нарезке Epic-а `worfy-mvp` выяснилось, что приложению нужно хранить ещё: список Project-ов, ручные Binding-и (автоматические вычисляются заново), вложения к сообщениям, последние известные Limits, корзину удалённых Node-ов. Всё это — состояние самого приложения, а не workflow: оно живёт в `~/Library/Application Support/worfy/`, не попадает в репозитории Project-ов и не дублирует ничего, что уже хранят Ticket-ы, `HANDOFF.md`, транскрипты или Gate. Правило ADR 0002 остаётся в силе: если факт о работе где-то уже записан workflow, worfy его читает, а не копирует.

worfy ничего не пишет в репозитории Project-ов — ни Card-ы, ни Layout, ни свои настройки: для остальных участников репозитория worfy невидим. Единственная запись вне `Application Support` — регистрация Project в общем конфиге Gate (`~/.claude/gate/config.json`). Синхронизация состояния worfy между машинами или с облаком — отдельное будущее решение.

## Considered Options

- Кнопка «вынести Card в репозиторий» (`<repo>/.worfy/cards/`). Отвергнуто владельцем: worfy не оставляет следов в репозиториях.

## Amendments

- 2026-11-04 — в `app-settings.json` папки данных worfy (`WORFY_DATA_DIR`) появилось поле `autoApproval`: режим
  Auto-approval (Off / Shadow / On) по id Project-а, нет записи — Off (worfy-auto-approve, Ticket 06). Режим —
  настройка Machine, а не Profile и не файл репозитория: Profile и репозиторий агент меняет обычной командой, а режим
  решает, отвечает ли worfy на запросы разрешения агента. Пишет его только переключатель под полем ввода
  Orchestrator-а через IPC `autoApproval.set` (канал `local`, с Linked machine не доступен). Пока worfy запущен с
  открытым debugging port или pipe (`--remote-debugging-port`, `--remote-debugging-pipe`) или с Node inspector
  (`--inspect`), окно worfy может вести любой процесс Machine, в том числе Bash агента, поэтому debugging port —
  это Auto-approval Off: `autoApprovalMode()` отвечает Off, `autoApproval.set` отказывает в Shadow и On, сохранённый
  режим действует снова после запуска без них. `app-settings.json` читается один раз при первом обращении; правка
  файла извне видна только после рестарта worfy, а следующая запись любой настройки Machine кладёт поверх неё
  состояние из памяти.
- 2026-11-05 — в том же `app-settings.json` появилось поле `autoContinue`: `{<id Project-а>: true}` для Project-ов, где
  worfy сам продолжает Run после ошибки API или Limits; нет записи или мусор в поле — Off (worfy-retry, Ticket 02).
  Как и `autoApproval`, это настройка Machine: пишет её только пункт Auto-continue в меню Modes Orchestrator-а через
  IPC `autoContinue.set` (каналы `local`, с Linked machine не доступны); Off удаляет запись Project-а.
- 2026-11-05 — поля `autoApproval` и `autoContinue` в `app-settings.json` и Eco mode в Profile теперь доступны Linked
  machine (worfy-retry, Ticket 13; решение владельца Q15–Q18 спеки worfy-retry: «полный доступ — значит действительно
  полный»). Каналы `autoApproval.*`, `autoContinue.*` и `ecoMode.*` помечены `project`: чтение и события смены — `read`,
  запись — `write`. Linked machine с Full access меняет все три режима, и запись идёт на Machine Project-а — в её
  `app-settings.json` и её Profile; на вызывающей Machine ничего не пишется. С Read only она видит режимы, а запись
  отклоняется на Machine Project-а до handler-а. Смена рассылается всем клиентам Machine Project-а (`autoApproval.changed`,
  `autoContinue.changed`, `ecoMode.changed`), так что открытое меню на обеих Machine обновляется сразу. Запрет debugging
  port остаётся и действует с обеих сторон: Machine Project-а по-прежнему отказывает в Shadow и On при своём debugging
  port; вызывающая Machine при своём debugging port или inspector-е пропускает через `linked.invoke` только Off (тот же
  текст отказа), потому что Machine Project-а не может знать, что окно вызывающей ведёт скрипт. Окно узнаёт причину по
  каналу `autoApproval.blockedHere` (`local`).
- 2026-11-07 — исключение для Product Session (ADR-0101, Epic `worfy-product-session`, Ticket 03): main пишет файл
  Mind map `mind-map.json` в папку Product Session Project-а — `docs/product/<тема>/` в Full mode,
  `<Workflow folder>/product/<тема>/` в Silent mode. Пишут его только tools `mind_map_*` и перетаскивание узла на
  экране (Ticket-ы 04, 09). Остальное собственное состояние worfy по-прежнему только в `WORFY_DATA_DIR`; в
  репозиторий эти файлы попадают docs PR-ом Orchestrator-а, сам worfy их не коммитит.
- 2026-11-09 — ADR-0105 (принят Orchestrator-ом под карт-бланш владельца 2026-11-09, владелец подтверждает при
  приёмке; Epic `worfy-pr-inbox`) добавляет два места состояния PR inbox:
  `<Project data folder>/pr-inbox.json` в `WORFY_DATA_DIR` (что пользователь видел: id, sha, время; без текстов
  коллег) и черновики ответов в `<Profile folder>/state/pr-inbox/drafts/` на этой машине, вне истории git Harness home:
  их пишет Session, main дописывает правку пользователя и отметку `sent`.
- 2026-11-20 — Epic `worfy-pr-review`, Ticket 07: новое место состояния — черновик ревью чужого PR,
  `<Profile folder>/state/pr-review/<owner>-<name>-<N>.json` на этой машине, рядом с черновиками ответов
  (`state/pr-inbox/drafts/`), вне репозиториев Project-а и вне истории git Harness home. Один файл на PR: `payload` —
  тело `POST /repos/{o}/{r}/pulls/{n}/reviews` (то, что проверяет `review-draft-lint`), плюс поля worfy — `anchors`
  (текст строк комментария и кто написал его последним), `suggestedEvent`, `agent`, `viewed`, `state`, `reviewUrl`,
  `submittedAt`, `error`. Пишет main (`src/main/github/pr-review-draft.ts`) через временный файл и rename, не чаще раза в
  500 ms на файл; с Ticket-а 08 — ещё Session Agent review через `bin/pr-review-draft`. Discard review удаляет файл;
  отправленный черновик хранится 30 дней и удаляется при первом обращении к черновикам Project-а после запуска worfy.
  Каналы `prReview.*` — `local`: Linked machine черновик не читает и не пишет. На GitHub worfy pending review не
  создаёт (ADR-0105).
- 2026-11-20 — ещё одно место состояния PR inbox (worfy-pr-review 04): `<Project data folder>/pr-searches.json` в
  `WORFY_DATA_DIR`, рядом с `pr-inbox.json` — сохранённые поиски PR вкладки Pull requests: имя, строка поиска и
  область каждого (This Project, организации Project-а, All of GitHub), не больше 20. Результаты поиска и тексты PR в
  файл не пишутся. Два встроенных поиска («Review requested from me · All of GitHub», «Reviewed by me · open») в файле
  не хранятся и не удаляются. Пишут файл только каналы `prSearch.save` и `prSearch.forget` (`'project', 'write'`):
  Linked machine с доступом Read only их не вызовет, `prSearch.saved` (`'project', 'read'`) ей открыт.
- 2026-11-21 — Epic `worfy-pr-review`, Ticket 11 (ADR-0112): в черновике ревью чужого PR новое поле `submittingAt` —
  время отметки `submitting`, ISO 8601. Оно остаётся после Submit-а, который GitHub не подтвердил: следующий Submit ищет
  ревью, данное не раньше него, и первые 5 минут после него не отправляет ревью снова. Заменяет его только отметка
  следующего POST; 4xx его удаляет. Пишет main (`src/main/github/pr-review-submit.ts`).
- 2026-11-24 — Epic `worfy-acceptance`, Ticket 09 (место добавил Ticket 01, запись в него — Ticket 03): отметки «Sent»
  вида Acceptance, `<Project data folder>/acceptance-sent.json` в `WORFY_DATA_DIR`, рядом с `pr-inbox.json`. Одна
  запись на пункт: Project, Epic, номер Ticket-а, номер пункта, hash его текста (16 знаков SHA-256), вердикт `pass` или
  `fail`, время отправки и число строк `owner-check` с этим вердиктом у пункта в тот момент. Слов владельца и текста
  пункта там нет. Пишет main (`src/main/acceptance/sent-store.ts`) через временный файл и rename: запись появляется,
  когда текст решения ушёл Orchestrator-у по каналу `actions.ownerCheck` (`'project', 'write'`), второе решение на тот
  же пункт заменяет первое, а запись удаляется, когда в checkout-е появилась новая строка `owner-check` с тем же
  вердиктом, пункт больше не ждёт владельца или его текст переписан. В Ticket и в репозиторий Project-а worfy ничего
  не пишет: строку пишет skill `owner-check` Harness-а (ADR-0002).
- 2026-11-25 — Epic `worfy-assistant`, Ticket-ы 03, 04 и 05 (ADR-0114): четыре места состояния Assistant-а, все в
  `WORFY_DATA_DIR`, вне репозиториев Project-а. Пишет только main, через `src/main/storage/json-file.ts`.
  - `<Project data folder>/assistant-items.json` — пункты ядра внимания одного Project-а (Ticket 03,
    `src/main/assistant/core/store.ts`): источник, Project, предмет, вид, начало, ревизия, состояние, обязанность.
    Пункт, по которому 14 дней не было события, удаляется, открытый тоже.
  - `<WORFY_DATA_DIR>/assistant/items.json` — такие же пункты, но не одного Project-а, а всей машины: Limits,
    строка Health check.
  - `<WORFY_DATA_DIR>/assistant-check-marks.json` — отметки планировщика проверок (Ticket 04,
    `src/main/assistant/schedule/app.ts`): по виду проверки (Slack, Jira) время последнего старта и последнего
    успеха и число неудач подряд (Ticket 22 эпика worfy-assistant). Файла нет, пока ни одна проверка не включена.
  - `<WORFY_DATA_DIR>/assistant/usage.json` — журнал расхода Assistant-а (Ticket 05,
    `src/main/assistant/budget/ledger.ts`): его вызовы с `usage` и `costUsd`, его автоматические пробуждения и цена
    остальных ходов worfy, чтобы оценить долю Assistant-а. Записи старше 8 дней удаляются.
- 2026-11-25 — Epic `worfy-assistant`, Ticket 07 (ADR-0114): два новых места состояния Assistant-а, оба в
  `WORFY_DATA_DIR`, вне репозиториев Project-а. Пишет только main, через `src/main/storage/json-file.ts`.
  - `<WORFY_DATA_DIR>/assistant/memory.json` — файл памяти Assistant-а (`src/main/assistant/duties/memory.ts`):
    обязанности, как их настроил пользователь (режим каждого действия, Project-ы, порог, включена ли), их счётчики
    (показано, принято, отклонено, проигнорировано, like, dislike) и пауза; правила, выведенные из dislike; и какие
    пункты счётчики уже учли. Учтённый пункт старше 14 дней удаляется. Файла нет, пока ни одна обязанность не
    менялась и ни один пункт не показан.
  - Поле `assistantRules` в `<Project data folder>/settings.json` — правила Assistant-а для процесса этого Project-а
    (например «land закончился, а Orchestrator спит»). Пишет только `writeProjectAssistantRules`
    (`src/main/projects/settings.ts`); Save диалога настроек Project-а это поле сохраняет как было.
- 2026-11-25 — Epic `worfy-assistant`, Ticket 06 (ADR-0114): ещё одно место состояния Assistant-а —
  `<WORFY_DATA_DIR>/assistant/wake.json`, файл решения о пробуждении. Пишет `src/main/assistant/wake/planner.ts`
  через `src/main/storage/json-file.ts` (`fileWakeStore` в `src/main/assistant/wake/loop.ts`): какие пункты переданы
  модели и сколько событий каждого (`delivered`), с какого момента ждёт каждый ещё не переданный пункт
  (`pendingSince`), пункты, по которым закрытый список не помог (`escalated`), время последнего пробуждения
  (`lastWakeAt`), день последней утренней сводки (`morningDay`) и время первого запуска (`since`). Пункты, которых ядро
  внимания больше не держит, уходят из файла при следующем пробуждении.
- 2026-11-25 — Epic `worfy-assistant`, Ticket 08 (ADR-0114): ещё одно место состояния Assistant-а —
  `<WORFY_DATA_DIR>/assistant/journal.json`, журнал действий закрытого списка. Пишет только
  `src/main/assistant/actions/closed-list.ts` через `src/main/storage/json-file.ts` (`actionJournalFile` в
  `src/main/assistant/actions/journal.ts`): по строке на каждое действие — какое, кто попросил (main, Assistant,
  пользователь), пункт ядра внимания, который его вызвал, и его обязанность, режим, Session, исход (сделано, отказ с
  причиной, передано модели) и точный текст, который ушёл. Строки старше 14 дней удаляются при следующей записи. В
  репозиторий Project-а и в Session-ы файл не пишется; ожидание сброса Limits у Session-ов на Canvas живёт только в
  памяти main.
- 2026-11-26 — Epic `worfy-assistant`, Ticket 10 (ADR-0114): Session Assistant-а и её память, всё в `WORFY_DATA_DIR`,
  вне репозиториев Project-а.
  - `<WORFY_DATA_DIR>/assistant/memory.json` (файл Ticket-а 07) теперь хранит и часть Session Assistant-а: открытые
    предложения (`proposals`, пишет `src/main/assistant/proposals/book.ts`), обязательства Assistant-а
    (`commitments`, не больше 50) и ответы пользователя (`answers`, по одному на тему, не больше 100) — их пишет
    `src/main/assistant/session/memory.ts` по tools `memory_note` и `memory_forget` сервера `worfy-app`. Два писателя
    одного файла: каждая запись читает файл и оставляет часть другого писателя как есть (`memoryFileStore` и
    `sessionMemoryStore` в `src/main/assistant/duties/memory.ts`). Каждая новая Session Assistant-а получает файл в
    первом сообщении.
  - `<WORFY_DATA_DIR>/assistant/session/` — пустая папка, cwd каждой Session Assistant-а
    (`src/main/vendors/claude/assistant-session.ts`): вне всех Project-ов, без файлов настроек. worfy в неё ничего не
    пишет; транскрипта Claude Code этой Session не хранит (`persistSession: false`), так что и в `~/.claude/projects`
    она ничего не оставляет.
- 2026-11-26 — Epic `worfy-assistant`, Ticket-ы 11, 14 и 16 (ADR-0114): три места состояния Assistant-а, которые эти
  Ticket-ы завели, а инвентарь пропустил. Все в `WORFY_DATA_DIR`, вне репозиториев Project-а; файлы пишет только main,
  через `src/main/storage/json-file.ts`.
  - `<WORFY_DATA_DIR>/assistant/window.json` — состояние раздела Assistant-а (Ticket 14,
    `src/main/assistant/window/store.ts`): отложенные пункты (пункт, его Project, до какого времени или до новой
    ревизии пункта), like и dislike сообщений Assistant-а с правилом, которое записал dislike, и разговор с
    пользователем. Разговор хранит не больше 200 сообщений, оценки — не больше 1000; старые уходят первыми. Сами
    пункты, обязанности и предложения остаются там, где их держат Ticket-ы 03, 07 и 09.
  - `<WORFY_DATA_DIR>/assistant/intro.json` — знакомство с Assistant-ом (Ticket 16, `src/main/assistant/intro/intro.ts`):
    что человек сделал с единственным предложением включить Assistant (принял, отказался или ещё нет), показано ли
    сообщение после обновления и должно ли знакомство или уже прошло.
  - `<WORFY_DATA_DIR>/assistant-sources/` — пустая папка, cwd каждой проверки источника через connector claude.ai
    (Ticket 11, `src/main/vendors/claude/connector-check.ts`, `CONNECTOR_CHECK_DIR`): вне всех Project-ов, без файлов
    настроек; main создаёт её перед проверкой. worfy в неё ничего не пишет; транскрипта Claude Code проверки не
    хранит (`persistSession: false`), так что и в `~/.claude/projects` она ничего не оставляет.
