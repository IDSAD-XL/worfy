# 04 — Pull requests: кнопки Fix checks, Resolve conflicts, Address comments по причинам PR

Type: task
Status: done 2026-11-18T19:13Z
PR: #2010
Blocked by: 01
Source: [spec.md](../spec.md), «Ticket-ы», 4; «Решение» → «Поток пользователя», A и C; «Как это выглядит»;
«Решения по реализации», 3 и 4; «Готово, когда», пункт о Pull requests

Кто: агент.

Не платформенный Ticket (renderer). Глубина ревью — `medium`; снимок экрана полосы «что дальше».

## Что происходит

- Группа Needs a fix — свой PR пользователя с красным CI, `CHANGES_REQUESTED` или конфликтом `DIRTY`
  (`src/main/github/inbox-groups.ts:119`). Свой PR с нитями, ждущими ответа, попадает в Needs my answer раньше
  (`:116`).
- Полоса «что дальше» для `needs-fix` даёт одну кнопку — Open checks, ссылку на страницу checks на GitHub
  (`src/renderer/pr-inbox/usePrInbox.ts:354-364`); вид действия — `NextAction` (`:313`): `link`, `send-all`,
  `draft-replies`.
- Полосу рисует `src/renderer/pr-inbox/PrInboxView.tsx:445-476`; кнопка Draft replies под нитями — `:522`, сама кнопка —
  `DraftRepliesButton` (`src/renderer/pr-inbox/DraftThread.tsx:669`). Экран read-only передаёт причину в `readOnly`
  (`src/renderer/pr-inbox/PrInboxView.tsx:405`).
- Английская страница: полоса и её кнопки — `docs/features/pr-inbox.md:80-81`.

## Что делаем

1. `NextAction` получает вид `{ kind: 'pr-follow', action }`. `nextStep` для `needs-fix`: главная кнопка — действие
   первой причины по функции Ticket-а 01 (`src/shared/actions/pr-follow.ts`), текст полосы говорит, что сделает
   кнопка; Open checks остаётся ссылкой рядом.
2. Остальные причины этого PR — кнопками рядом с главной (например, Fix checks и Address comments на PR с красным CI и
   запросом изменений).
3. Needs my answer у своего PR: Address comments рядом с Draft replies.
4. Щелчок — `actions.prFollow` с `projectId`, `repo`, `pr`, `action`; ответ `delivery` — короткий toast «Sent to
   <Session>», «Queued for <Session>» или «Started a Session»; отказ — его причина в toast-е.
5. Состояние кнопки — hook `usePrFollowState` Ticket-а 01 (`src/renderer/canvas/actions/gates.ts`); своей копии
   нет. Кнопка неактивна с tooltip-ом: пустой шаблон («Set the template in Project settings…»), экран read-only, причина
   отказа функции 01.
6. Английская страница `docs/features/pr-inbox.md`: кнопки, порядок причин, маршрут щелчка (кратко, ссылкой на
   `projects.md`). Перевод — Ticket 06.

## Готово, когда

- [ ] Unit test (`test/unit/pr-inbox-view.test.tsx`): PR в `DIRTY` с красным CI — главная Resolve conflicts, рядом Fix
      checks, Open checks — ссылка; только красный CI — Fix checks; только `CHANGES_REQUESTED` — Address comments; в
      Needs my answer — Address comments рядом с Draft replies.
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · bb7549a9a330fb9fb30fe01f178f4141a1583946
  - evidence: review pass · PR #2010 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Unit test: пустой шаблон и экран read-only — кнопка неактивна, tooltip с причиной.
  - evidence: test-run pass · `pnpm test` exit 0 · mac - · bb7549a9a330fb9fb30fe01f178f4141a1583946
  - evidence: review pass · PR #2010 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] e2e test (`test/e2e/pr-inbox.spec.ts`, gh stub): Fix checks создаёт Session Node, её первое сообщение —
      `/worfy:pr-fix checks owner/web#118 <sha>` с head из stub-а.
  - evidence: review pass · PR #2010 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Снимок экрана полосы с кнопками — в «Итог» (снимок ревью — в scratchpad, в репозиторий не кладётся).
  - evidence: review pass · PR #2010 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] Английская страница `docs/features/pr-inbox.md` описывает кнопки.
  - evidence: commit pass · worfy-pr-follow/04: Resolve conflicts, Fix checks and Address comments in Pull requests · - - · bb7549a9a330fb9fb30fe01f178f4141a1583946
  - evidence: review pass · PR #2010 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44367113149/job/135061041916 · ci - · db344cac2282b839c07091d287da991f9bf8fa09

## Где в коде

- `src/renderer/pr-inbox/usePrInbox.ts`
- `src/renderer/pr-inbox/PrInboxView.tsx`
- `src/renderer/pr-inbox/PrFollowButton.tsx` (новый, по образцу `DraftRepliesButton`)
- `test/unit/pr-inbox-view.test.tsx`, `test/e2e/pr-inbox.spec.ts`
- `docs/features/pr-inbox.md`

Только читать: `src/shared/actions/pr-follow.ts` и `src/renderer/canvas/actions/gates.ts` (Ticket 01), `src/shared/ipc/actions.ts`,
`src/renderer/pr-inbox/DraftThread.tsx`.

## Вне скоупа

- «Watch until merge» и чип «Watching» — часть 2. Ticket Node и Command palette — Ticket 05.
