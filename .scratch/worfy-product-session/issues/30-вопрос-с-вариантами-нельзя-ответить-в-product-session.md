# 30 — вопрос с вариантами нельзя ответить в Product Session

Type: bug
Status: claimed 2026-11-09T10:29Z
Branch: worfy-product-session/30
Source: владелец 2026-11-09, worfy на ПК с Windows: Product Session задала вопрос с вариантами (AskUserQuestion),
карточки не было вовсе, Session висела в «needs permission»; [spec.md](../spec.md)

Платформенный Ticket: нет (правка main — новый канал `agent.requests` и память открытых запросов, без путей и процессов
ОС). Глубина ревью — `medium`; снимок экрана.

## Что происходит

- Session в «needs permission», а в чате Product Session нет карточки: ответить нечем, Session ждёт.
- Воспроизведено e2e test-ом: вопрос открыт, окно перезагружено (View ▸ Reload, Ctrl+R на Windows) — чат Product
  Session без карточки (`question-card` — 0 штук), шапка и Node говорят «needs permission», Badge Node-а — «Needs
  permission» вместо «Waits for answer». Окно, открытое или перезагруженное после того, как событие
  `question_request` / `permission_request` ушло, этого события не получало: renderer подписывается на `agent.event`
  один раз и прошлых событий не получает (`src/renderer/session/store.ts`, `ensureAgentEvents`), а main состояние
  отдаёт заново (`sessions.views`). В обычной Session видна хотя бы строка вызова AskUserQuestion из файла транскрипта,
  в чате Product Session вызовы tool-ов скрыты (`shownInProductChat`) — не видно ничего.
- Обычный путь проверен и работает: вопрос самой Session и вопрос Subagent-а, запрос разрешения Subagent-а (Allow) и
  самой Session (Deny) — карточки в чате шириной < 260 px (окно 1160, список агентов открыт), варианты, «Other»,
  Submit, Decline, Allow, Deny внутри колонки и над полем ввода.

## Что делаем

1. Main помнит событие каждого открытого запроса (`PermissionGate.openRequests`) и отдаёт их по новому каналу
   `agent.requests` (чтение; Linked machine с доступом read видит).
2. Renderer: пока Session в `needs_permission`, а у окна нет ни одного её открытого запроса, вид Session и Badge Node-а
   спрашивают main и берут открытые запросы в журнал Session (без повторов). Карточка рисуется, Badge снова отличает
   вопрос от запроса разрешения.
3. Если и у main открытых запросов нет — чат пишет «The Session waits for an answer this window cannot show. Interrupt
   refuses the request.», а не молчит.

## Готово, когда

- [ ] e2e test (`test/e2e/product-session.spec.ts`): вопрос открыт, окно перезагружено — карточка вопроса в чате
  Product Session, Badge «Waits for answer», ответ доходит до Claude Code (красный до правки).
- [ ] e2e test: в окне 1160 со списком агентов вопрос Session и вопрос Subagent-а отвечаются (вариант, «Other»),
  запрос разрешения Subagent-а — Allow (tool выполнился), Session — Deny (отказ); кнопки внутри колонки чата.
- [ ] Contract test `agent.requests` (`test/contract/permissions.test.ts`) и unit test `useWaitingRequests`
  (`test/unit/waiting-requests.test.tsx`).
- [ ] Снимок (тёмная тема) `../evidence/30-permission-card-dark.png`, только текст fixture.
- [ ] `pnpm lint`, `pnpm typecheck`, unit test-ы, что импортируют `src/renderer/session`, e2e
  `test/e2e/product-session.spec.ts`, gate fast — exit 0; `ci-ok` на PR зелёный.

## Тесты

- `test/e2e/product-session.spec.ts`; `test/contract/permissions.test.ts`; `test/unit/waiting-requests.test.tsx`;
  `test/unit/link-access.test.ts`; unit test-ы, что импортируют `src/renderer/session`.

## Где в коде

- `src/main/agent/permissions.ts`, `src/main/agent/session.ts`, `src/main/ipc/agent.ts`, `src/shared/ipc/agent.ts`
- `src/renderer/session/store.ts`, `src/renderer/session/open-requests.ts`, `src/renderer/session/SessionView.tsx`,
  `src/renderer/session/session.css` (только `.w-session__unseen`), `src/renderer/canvas/badges/NeedsPermission.tsx`
- `src/main/agent/fake-query.ts` (строка `question` берёт `agentID`), `test/fixtures/agent-scripts/product-question.jsonl`
- `test/e2e/product-session.spec.ts`, `test/contract/permissions.test.ts`, `test/unit/waiting-requests.test.tsx`,
  `test/unit/link-access.test.ts`
- `docs/features/sessions.md`, `docs/features/product-session.md`, `docs/features/ru/sessions.md`,
  `docs/features/ru/product-session.md`
- `.scratch/worfy-product-session/evidence/30-*.png`

## Итог
