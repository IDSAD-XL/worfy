# 99 — Sidebar «All Projects» для Sessions и ADR, карточки Projects с живым состоянием

Type: feature
Status: open
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
- [ ] Sessions и ADR в «All» показывают все Project-ы по группам; клик по чужому Project-у открывает его; unit test-ы.
- [ ] Карточки Projects и badge busy по прототипу; e2e на двух fixture Project-ах.
- [ ] `docs/features/app-shell.md` (раздел Sidebar) и `docs/features/sessions.md` описывают новое поведение.
- [ ] Снимки dev build-а: тёмная и светлая тема, «All» с двумя Project-ами в Sessions, ADR и Projects; fixture Project-ы.
- [ ] gate fast — exit 0; `ci-ok` на PR зелёный.

## Где в коде

- `src/shared/ipc/claude-home.ts`, `src/shared/ipc/docs.ts`, `src/shared/ipc/sessions.ts`, `src/shared/ipc/layout.ts` —
  существующие каналы по одному Project-у; новый канал рядом.
- `src/main/` — обработчик нового канала (место выбрать по `src/main/claude-home/` и `src/main/docs/`).
- `src/renderer/shell/sidebar/SessionsSection.tsx`, `AdrSection.tsx`, `ProjectsSection.tsx` — группы по Project-ам,
  карточки, badge.
- `src/renderer/shell/sidebar-scope.ts` (`projectsInScope`), `src/renderer/shell/SidebarSection.tsx` (`scope`,
  `ScopeNote`).
- `test/unit/`, `test/contract/`, `test/e2e/sidebar-rail.spec.ts`.
