# 127 — «Open» Session из другого Project-а не переключает Project

Type: bug
Status: done 2026-11-20T12:08Z
PR: #2087
Blocked by: none
Source: владелец 2026-11-19 во время приёмки worfy-pr-follow 07: «Open» у Session, которая работает над PR (вопрос
«Push / Not now» skill-а `pr-fix`, его уведомление), при другом активном Project-е не переключил Project; после ручного
переключения открыт нужный чат.

Кто: агент.

## Что происходит

- Действие правки PR (Fix checks, Resolve conflicts, Address comments) запускает Session в Project-е PR-а. Skill
  `pr-fix` задаёт ей вопрос «Push / Not now». Человек в это время может быть в другом Project-е.
- Вопрос Session, которой нет на экране, приходит toast-ом с кнопкой «Open» (`src/renderer/session/question-toast.ts:47`).
  «Open» зовёт `openAsking` (`:26-31`): находит Node Session через `notificationTarget` и вызывает `openSession(target)`.
- `openSession` (`src/renderer/session/navigation.ts:92-102`) ставит `view: 'session'` и `opened[target.projectId]`, но
  активный Project не меняет. Окно показывает Session view активного Project-а; нужный чат запомнен за другим
  Project-ом и виден только после ручного переключения — ровно то, что видел владелец.
- Тот же пробел у щелчка по уведомлению ОС о Session на этой машине: `src/renderer/canvas/overlays/NotificationTarget.tsx:114-121`
  вызывает `openProject` только при `machine !== null` (Linked machine, `:116`), а для своей машины — только
  `openSession(target)` (`:121`).
- Пути, которые Project переключают:
  - уведомление о PR и утренний дайджест — `openPrInboxOf` (`src/renderer/pr-inbox/open.ts:18-22`):
    `openProject(windowMachine(), projectId)`, если `projectId !== activeId`;
  - Session другого Project-а в sidebar — `openElsewhere` (`src/renderer/shell/sidebar/SessionsSection.tsx:262-271`):
    сначала `requestSession(other.id, sessionId)`, затем `openProject(windowMachine(), other.id)`;
  - `openProject` — `src/renderer/projects/useProjects.ts:143`.

## Что делаем

1. Открытие Session по «Open» toast-а вопроса и по уведомлению ОС на своей машине переключает Project, если Session —
   в другом Project-е, тем же путём, что sidebar (`requestSession`, затем `openProject`) или общим helper-ом рядом с
   `openSession`. Решает implementer; путь Linked machine не меняется.
2. Отказ `openProject` виден человеку (toast с причиной), а не только в console.
3. Проверить остальные места, где `openSession` зовут с Node другого Project-а (`git grep -n 'openSession('` в
   `src/renderer/`), и закрыть те же пробелы; список — в «Итог».

## Где в коде

- `src/renderer/session/question-toast.ts:26-31`, `:47` — «Open» toast-а вопроса.
- `src/renderer/canvas/overlays/NotificationTarget.tsx:110-121` — уведомление ОС о Session.
- `src/renderer/session/navigation.ts:92-102` — `openSession`; helper «открыть Session с переключением Project-а» —
  рядом.
- Образцы: `src/renderer/pr-inbox/open.ts:18-22`, `src/renderer/shell/sidebar/SessionsSection.tsx:262-271`.
- Test-ы: unit test toast-а вопроса и overlay уведомления (Session в другом Project-е — Project переключён, открыт её
  чат; в активном — `openProject` не зовётся); e2e — по таблице путей e2e, если там есть сценарий toast-а вопроса.

## Готово, когда

- [ ] «Open» toast-а вопроса Session другого Project-а переключает Project и открывает её чат.
  - evidence: test-run pass · `pnpm test test/unit/question-card.test.tsx test/unit/permission-card.test.tsx` exit 0 · mac - · 799539bb46395fc4a7b0749b85339a68142f78c5
  - evidence: test-run pass · `pnpm test test/unit/question-card.test.tsx test/unit/permission-card.test.tsx` exit 0 · mac - · aa197d7e6694bd1bede012e4f7ea0c0106646a0e
- [ ] Щелчок по уведомлению ОС о Session другого Project-а на своей машине делает то же.
  - evidence: test-run pass · `pnpm test test/unit/question-card.test.tsx test/unit/permission-card.test.tsx` exit 0 · mac - · 799539bb46395fc4a7b0749b85339a68142f78c5
  - evidence: test-run pass · `pnpm test test/unit/question-card.test.tsx test/unit/permission-card.test.tsx` exit 0 · mac - · aa197d7e6694bd1bede012e4f7ea0c0106646a0e
- [ ] Session активного Project-а открывается как сегодня, без лишнего `openProject`.
  - evidence: test-run pass · `pnpm test test/unit/question-card.test.tsx test/unit/permission-card.test.tsx` exit 0 · mac - · 799539bb46395fc4a7b0749b85339a68142f78c5
  - evidence: test-run pass · `pnpm test test/unit/question-card.test.tsx test/unit/permission-card.test.tsx` exit 0 · mac - · aa197d7e6694bd1bede012e4f7ea0c0106646a0e
- [ ] Unit test-ы на оба пути зелёные; CI зелёный.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44727572617/job/136277413013 · ci - · e0518be58db068e0be4ff9f8e18795ad17e165a8

## Итог

- Причина: «Open» toast-а вопроса и щелчок по уведомлению ОС о Session своей машины звали только `openSession`. Он
  запоминает Session за её Project-ом и ставит `view: 'session'`, но активный Project не меняет, а Session view рисует
  последнюю Session активного Project-а.
- Новый helper `openSessionInProject` в `src/renderer/session/open-in-project.ts` (рядом с `navigation.ts`). Session
  активного Project-а открывается сразу, как раньше, без `openProject`. Для другого Project-а — сначала
  `openProject(windowMachine(), id)`, после ответа `openSession`. Отказ — error toast «<Project> could not be opened:
  <причина>», ничего не открывается. Его зовут `openAsking` (`question-toast.ts`) и overlay
  `NotificationTarget.tsx` для своей машины. Путь Linked machine не менялся только у overlay; «Open» toast-а в окне на
  Linked machine теперь тоже идёт через `openProject(windowMachine(), id)` (`linked.open` и смена адреса окна) —
  раньше был только `openSession` (раунд ревью 1).
- Overlay уведомления на своей машине теперь спрашивает views Session Node-ов всех Project-ов (раньше только активного),
  а Session из registry ищет в Project-е по её корню (раньше только в активном) — так же, как на Linked machine. Без
  этого уведомление о Session другого Project-а в окне, которое ещё не знало её Node, не находило её. Решено без
  владельца.
- Helper — отдельный файл, а не `navigation.ts`: `navigation.ts` импортирует почти весь renderer и десятки unit test-ов,
  часть из них подменяет `useProjects.ts` без `openProject`. Решено без владельца.
- `useProjects.ts` — новая функция `projectsNow()` (список Project-ов вне React), чтобы helper знал активный Project.
  Файла нет в «Где в коде». Решено без владельца.
- Порядок «сначала `openProject`, потом `openSession`», а не как в sidebar (`requestSession`, затем `openProject`): Node
  Session уже известен, и Session view не показывает на миг чат чужого Project-а. Решено без владельца.
- Остальные вызовы `openSession(` в `src/renderer/` (`git grep -n 'openSession(' src/renderer/`) проверены: все
  открывают Session активного Project-а — Node-ы и badge-и Canvas-а (`OrchestratorNode`, `SessionNode`,
  `SubagentNode`, `NeedsPermission`, `WaitsForAnswer`), `FirstEpic`, `start-modal`, команды и поиск по транскриптам
  Command palette (Project палитры — активный), `SessionsSection`, `SessionPicker`, `HistoryPopover`,
  `ExternalSessionPanel`, `SubagentsRail`, `SpanPanel` Work track-а, `DetailPanel` Run history (экран чужого Project-а
  закрывается при смене Project-а), `GettingStartedPanel` (сам зовёт `openProject` перед `openSession`). Пробелов
  не нашлось.
- Test-ы: сначала красные 4 новых случая (`question-card.test.tsx` — 2, `permission-card.test.tsx` — 2; exit 1), после
  правки зелёные (66 из 66, exit 0). Все unit test-ы, что импортируют тронутые модули, и contract
  `test-timeout-scale.test.ts`: 81 файл, 1594 test-а, exit 0. e2e `session-question.spec.ts` и `linked-notify.spec.ts`
  целиком под `/tmp/worfy-e2e.lock`: 3 passed, exit 0. Тронутые пути не названы в `scripts/e2e-specs.table.json` —
  CI гоняет весь e2e.
- `docs/features/sessions.md` (раздел Notifications) описывает переключение Project-а; перевод `ru/` не правлен (ADR-0088).

### Раунд ревью 1

- Low 1: окно, загруженное после старта Session, знает views только Canvas-а активного Project-а, и «Open» toast-а
  вопроса не находил Session или Orchestrator другого Project-а — падал в Session view активного Project-а, исходный
  bug. Теперь `openAsking` в таком случае спрашивает у каждого Project-а машины окна `sessions.views`, а Orchestrator —
  через `layout.get` и `orchestrator.view`, и только потом открывает Session через `openSessionInProject`. Решено без
  владельца: Orchestrator ищется по Node-у в Layout-е, отдельного channel-а «Orchestrator Project-а» нет.
- Low 2: «Open» в окне на Linked machine переключает показанный Project той машины (`linked.open`, адрес окна), без
  `projects.select`; поведение оставлено, добавлен unit test. Строка выше про путь Linked machine исправлена.
- Test-ы: два новых случая окна после перезагрузки (Session Node и Orchestrator другого Project-а) красные на прежнем
  head (exit 1), после правки зелёные; случай Linked machine — новый (на прежнем head тоже красный: view Session не была
  загружена). `question-card.test.tsx` — 34 из 34, exit 0. Все unit test-ы, что импортируют тронутые модули, и
  `test-timeout-scale.test.ts`: 81 файл, 1597 test-ов, exit 0. `pnpm lint`, `pnpm typecheck` — exit 0.
