# 127 — «Open» Session из другого Project-а не переключает Project

Type: bug
Status: open
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
- [ ] Щелчок по уведомлению ОС о Session другого Project-а на своей машине делает то же.
- [ ] Session активного Project-а открывается как сегодня, без лишнего `openProject`.
- [ ] Unit test-ы на оба пути зелёные; CI зелёный.
