# 10 — Комментарии к строкам чужого PR: «+» в gutter, `c`, диапазон, Suggest change, Pending и «Written by the agent», полоса Your review, Discard

Type: task
Status: open
Blocked by: 07, 09
Source: [spec.md](../spec.md), «Ticket-ы», 10; «Как пользователь идёт по экрану», A (шаги 5–6) и E; «Экран»; «Решения по
реализации», 6 и 7 («Комментарии»); «Вопросы владельцу», Q7 раунда;
[critic](../../../docs/product/critic/worfy-pr-review-2026-11-20.md), возражение 1 и «Alternative»

Кто: агент.

Не платформенный Ticket (renderer). Глубина ревью — `medium` (решение владельца 2026-11-20, Q7 раунда: бывший Ticket 09
разделён, ступень `max` — только у Submit, Ticket 11).

Вне Epic-а: Ticket начинается после merge `worfy-changes-view` 05 (комментарии к строкам в Changes) — решение владельца
2026-11-20, Q7 раунда, возражение 1 critic-а: popover и клавиши берутся оттуда. Поле Blocked by берёт только номера
этого Epic-а.

## Что происходит

- После Ticket-а 09 Review mode показывает diff, дерево, нити и Viewed; черновик ревью и его каналы — Ticket 07;
  Agent review пишет свои комментарии в тот же черновик — Ticket 08.
- `worfy-changes-view` 05 даёт комментарий к строке Changes: «+» в gutter, `c`, диапазон, popover, ⌘↵ — адресат там
  Session.
- Комментарий вне diff-а PR GitHub отвергает (422); агент может ошибиться строкой.

## Что делаем

1. В Review mode — тот же popover и те же клавиши, что у `worfy-changes-view` 05; адресат — черновик ревью
   (`prReview.saveComment`). Suggest change вставляет блок `suggestion` с текстом выбранных строк; ⌘↵ — сохранить.
2. Комментарий на строке — «Pending · Edit · Delete»; комментарий агента — «Written by the agent · Edit · Delete»;
   правка человеком делает комментарий его (`by: 'person'`).
3. Комментарий к строке не из diff-а — списком «Not on a changed line» над файлом; Move to line или Delete.
4. Полоса Your review: «N pending comments on M files» и «(K by the agent)»; Discard с подтверждением «Discard N
   pending comments?»; Finish review (до Ticket-а 11 неактивна с tooltip «Coming next»; неактивна и пока Session
   пишет).
5. Строка списка PR с черновиком — chip `Review draft` (tooltip «3 pending comments, started on 3f2a9c1»;
   `prReview.drafts`).

## Готово, когда

- [ ] Unit `test/unit/review-comments.test.tsx` (новый): «+» и `c` открывают popover; диапазон; Suggest change;
      Pending и «Written by the agent»; правка делает комментарий человека; «Not on a changed line»; Discard с
      подтверждением; Finish review неактивна, пока Session пишет. Красный до правки — в «Итог».
- [ ] e2e `test/e2e/pr-review.spec.ts`: комментарий → перезапуск worfy → черновик на месте; chip `Review draft` в
      строке; на `WORFY_AGENT=fake` — правка комментария агента; снимки обеих тем.
- [ ] Contract `test/contract/pr-review-draft.test.ts` и `test/contract/pr-search.test.ts`: ни одной записи на GitHub от
      комментариев, Discard и открытого Review mode.
- [ ] `test/unit/changes-view.test.tsx` и `test/e2e/changes.spec.ts` зелёные: комментарии Changes не изменились.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/renderer/pr-review/ReviewMode.tsx`, `src/renderer/pr-review/ReviewBar.tsx` (новый)
- `src/renderer/changes/LineComment.tsx` (из `worfy-changes-view` 05; сверить с `main`), `src/renderer/changes/DiffPane.tsx`
- `src/renderer/pr-inbox/PrInboxView.tsx` (chip `Review draft`)
- `test/unit/review-comments.test.tsx` (новый), `test/e2e/pr-review.spec.ts`

Только читать: `src/shared/ipc/pr-review.ts`, `src/main/github/pr-review-draft.ts` (Ticket 07),
`.scratch/worfy-changes-view/issues/05-*.md`.

## Вне скоупа

- Диалог Finish review и отправка — Ticket 11. Ответ в существующей нити — черновик и Send PR inbox без изменений.
