# 99 — Sidebar «All Projects» для Sessions и ADR, карточки Projects с живым состоянием

Type: feature
Status: done 2026-11-11T12:08Z
PR: #1790
Blocked by: —
Source: worfy-polish 94 (sidebar варианта C, PR #1786), раздел «Итог» → «Следующий шаг»; вердикт первого раунда
review #1786, пункт 9: follow-up про IPC по всем Project-ам должен быть отдельным Ticket-ом.

## Что происходит

В worfy-polish 94 sidebar получил переключатель Project-а сверху: «All Projects» или один Project. Владелец о нём:

> «сверху всё ещё должен быть свитчер по проектам с возможностью выбрать «Все» или один какой-то конкретный. Он,
> соответственно, будет менять контент внутри сайдбара, чтобы у юзера был выбор, смешивать информацию о всех проектах в
> отображении или нет.»

Pipeline, Pull requests и Epics фильтруются переключателем: их данные по всем Project-ам renderer уже читает. Sessions и
ADR в «All» показывают только открытый Project и пишут это строкой «<имя> only: this list does not show other
Projects.» (`src/renderer/shell/SidebarSection.tsx`, `ScopeNote`). Им нужен IPC, которого нет:

- **Sessions.** `claudeHome.live` и `claudeHome.sessions` (`src/shared/ipc/claude-home.ts`) берут один `projectRoot`, и
  каждый держит watcher в main до `claudeHome.close`. Session-ы worfy (Node-ы на Canvas) читаются из `layout.get`
  (`src/shared/ipc/layout.ts`) и `sessions.views` (`src/shared/ipc/sessions.ts`) — тоже по одному `projectId`. Если
  открыть их по всем Project-ам сразу, получится по watcher-у на Project в каждом окне. Кнопки «New session», «Product
  Session» и History работают с открытым Project-ом.
- **ADR.** `docs.open` (`src/shared/ipc/docs.ts`) читает документы одного Project-а и шлёт `docs.changed` окну до
  `docs.close`: watcher на каждый `projectId`.

Прототип (Card `card-d8349882`, вариант C) показывает и то, что 94 не сделал по той же причине:

- **Карточки Projects** в две строки с живым состоянием каждого Project-а: «N busy · N PR need you · N waits». Панель
  Projects в 94 оставила существующие строки.
- **Badge Sessions на rail-е** в прототипе считает busy Session-ы (`.cnt.working`). В 94 badge считает live Session-ы
  открытого Project-а и стоит в нейтральном тоне (`.cnt.muted`): busy по всем Session-ам renderer не знает.

## Что делаем

1. Один ответ main с живым состоянием каждого Project-а Machine-ы окна: live и busy Session-ы, PR, которые ждут
   пользователя, Ticket-ы в waits. Разовый ответ плюс одно событие на изменение, без watcher-а на Project в каждом окне.
2. Sessions в «All»: Session-ы всех Project-ов, сгруппированные по Project-у, как Epics в 94. Клик по Session-у другого
   Project-а сначала открывает Project, потом Session. Строку «… only» убрать.
3. ADR в «All»: разовый список ADR каждого Project-а без watcher-а; клик по ADR другого Project-а открывает его так же.
4. Карточки Projects с «N busy · N PR need you · N waits» по прототипу.
5. Badge Sessions — число busy Session-ов в тоне working, как в прототипе.

## Готово, когда

- [ ] IPC с состоянием каждого Project-а: contract test-ы на ответ и на событие изменения; в main нет watcher-а на Project
      на каждое окно.
  - evidence: test-run pass · `pnpm test test/contract/project-pulse.test.ts test/contract/docs.test.ts test/contract/workflow-stages.test.ts` exit 0 (in `pnpm test` exit 0) · mac - · ae30f5a8acc5a7a3a2ab231a8d7a87d23b2d5fe5
- [ ] Sessions и ADR в «All» показывают все Project-ы по группам; клик по чужому Project-у открывает его; unit test-ы.
  - evidence: test-run pass · `pnpm test test/unit/sidebar-all-projects.test.tsx test/unit/sidebar-section.test.tsx test/unit/adr-section.test.tsx` exit 0 (in `pnpm test` exit 0) · mac - · ae30f5a8acc5a7a3a2ab231a8d7a87d23b2d5fe5
- [ ] Карточки Projects и badge busy по прототипу; e2e на двух fixture Project-ах.
- [ ] `docs/features/app-shell.md` (раздел Sidebar) и `docs/features/sessions.md` описывают новое поведение.
  - evidence: commit pass · Sidebar «All Projects»: Sessions, ADR and live Project cards (worfy-polish 99) · - - · b5be304e827b486322a296ed62a6e078cc17dca3
- [ ] Снимки dev build-а: тёмная и светлая тема, «All» с двумя Project-ами в Sessions, ADR и Projects; fixture Project-ы.
- [ ] gate fast — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · ae30f5a8acc5a7a3a2ab231a8d7a87d23b2d5fe5

## Где в коде

- `src/shared/ipc/claude-home.ts`, `src/shared/ipc/docs.ts`, `src/shared/ipc/sessions.ts`, `src/shared/ipc/layout.ts` —
  существующие каналы по одному Project-у; новый канал рядом.
- `src/main/` — обработчик нового канала (место выбрать по `src/main/claude-home/` и `src/main/docs/`).
- `src/renderer/shell/sidebar/SessionsSection.tsx`, `AdrSection.tsx`, `ProjectsSection.tsx` — группы по Project-ам,
  карточки, badge.
- `src/renderer/shell/sidebar-scope.ts` (`projectsInScope`), `src/renderer/shell/SidebarSection.tsx` (`scope`,
  `ScopeNote`).
- `test/unit/`, `test/contract/`, `test/e2e/sidebar-rail.spec.ts`.

## Итог

Код — ветка `worfy-polish/99`.

**Что изменилось.**
- **Живое состояние всех Project-ов одним ответом.** Новый канал `projectPulse.get` и событие `projectPulse.changed`
  (`src/shared/ipc/project-pulse.ts`): для каждого Project-а Machine-ы — live Session-ы, сколько из них busy, сколько PR
  ждут пользователя (группы needs review / answer / fix), сколько Ticket-ов в работе blocked или ждут человека.
  В main один hub на все окна (`src/main/claude-home/pulse.ts`, `src/main/ipc/project-pulse.ts`): раз в секунду
  листает папку реестра live Session-ов (`~/.claude/sessions`), пока подписано хоть одно окно, и читает её заново при
  изменении. Пока есть live Session, каждый poll проверяет её pid сигналом 0 (`processGoneNow`, без `ps` и PowerShell):
  так ловится процесс, умерший без удаления файла; полное чтение с проверкой времени старта (pid занят другим
  процессом) — раз в минуту. Session относится к Project-у, чей root или worktree содержит её cwd, к самому глубокому;
  Session вложенного Project-а в «All» показана и посчитана один раз, под ним. Watcher-а на Project нет ни в одном окне.
- **Linked machine не видит local-only Project-ы.** Ответ `projectPulse.get` и каждое `projectPulse.changed` для
  удалённого клиента идут без Project-ов с `localOnly`, как `projects.list`.
- **Чтение, начатое до ухода последнего окна, ничего не оставляет**: счётчик поколений в hub-е, следующее окно читает
  заново.
- **PR без новых вызовов GitHub.** Число «PR need you» — из снимка PR inbox, который main уже читает
  (`appPrInboxSource`); `null`, пока PR inbox Project-а выключен. Группы «need you» — один `PR_NEED_YOU` в
  `src/shared/ipc/pr-inbox.ts` для карточки и badge-а Pull requests.
- **Waits из Stage-ей, которые main уже считает.** `StageHub.current(root)` и `StageHub.onChange` (`src/main/workflow/stages.ts`):
  hub читает последний снимок, ничего не запуская. Project, чей Pipeline не показывает ни одно окно, — `waits: null`
  (в «All» Pipeline section открывает все Project-ы, так что там число есть).
- **ADR других Project-ов разово.** `docs.adrs` читает ADR Project-а без watcher-а и подписки; AdrSection зовёт его
  для других Project-ов каждый раз, когда раздел попадает в панель.
- **Sessions и ADR в «All».** Открытый Project первым, потом каждый другой, у которого есть live Session / ADR, под
  своим именем, как Epics в 94. Клик по Session-у другого Project-а: запрос `requestSession`
  (`src/renderer/shell/session-request.ts`), потом `openProject`; раздел нового Project-а открывает Session, когда её
  Node есть в Layout (не дольше 15 с). Клик по ADR другого Project-а: `openProject`, потом `openAdr`, как «Go to» палитры.
  Отказ открыть Project — строка с role alert. На read-only экране скрытая Node Session-а другого Project-а не
  возвращается, раздел говорит почему, как у своих строк.
- **Карточки Projects.** Project Machine-ы окна — карточка в две строки (44 px): имя и ветка, ниже
  «N busy · N PR need you · N waits» или «quiet»; busy — цветом работы, остальное — цветом блока; нулевые и
  неизвестные части не пишутся. Project Linked machine — одна строка, как раньше.
- **Badge Sessions** — число busy Session-ов Project-ов, которые показывает переключатель, тоном working
  («N busy»), как `.cnt.working` прототипа.

**Что убрано или заменено.**
- Строка «<имя> only: this list does not show other Projects.» (`ScopeNote`) и вид `scope="current"` у
  `SidebarSection`: Sessions и ADR теперь `filtered`.
- Badge Sessions больше не считает live Session-ы открытого Project-а нейтральным тоном: он считает busy.
- Строка Project-а в Projects (`ListRow`) для Project-ов Machine-ы окна заменена карточкой.
- Число в заголовке ADR (`adr-count`) и «N live» Sessions в «All» считают все показанные Project-ы.

- Полное перечитывание реестра раз в 5 с, пока есть live Session: теперь раз в минуту, между ними — сигнал 0 по pid.

**Решения без владельца.**
- Канал без `close`: окно подписывается один раз и остаётся подписанным до закрытия. Иначе Linked machine, которая
  обслуживает все окна Machine-ы одним клиентом, закрывала бы подписку всех окон по закрытию одного
  (как в worfy-windows 64/69).
- «Waits» — Ticket-ы в работе, которые blocked или ждут человека (`waits` не `agent`), как «waits for you» в
  прототипе; точка Pipeline на rail-е считает по-прежнему всех ждущих.
- Session другого Project-а подписана именем из реестра Claude Code и «terminal»/«desktop»: Canvas и история того
  Project-а не читаются, поэтому «worfy» там не отмечается, пока Project не открыт.
- Перевод `docs/features/ru/` не правился: `rules.md`, раздел «Язык» — в PR с поведением правится только английская
  страница.

**Снимки dev build-а** — ждут: локально Electron не запускался (правило владельца про фокус окон). e2e
`test/e2e/sidebar-rail.spec.ts` снимает «projects-cards», «sessions-all», «adr-all» в обеих темах под
`WORFY_SNAPSHOT_DIR` (имена `99-sidebar-*`).
