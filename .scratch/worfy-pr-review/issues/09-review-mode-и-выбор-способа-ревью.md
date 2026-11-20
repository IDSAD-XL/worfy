# 09 — Review mode и выбор способа ревью: Start review с меню Review myself / Agent review, дерево, diff, Viewed, «N new commits», смена способа, Read only

Type: task
Status: open
Blocked by: 01, 05, 06, 07, 08
Source: [spec.md](../spec.md), «Ticket-ы», 9; «Решение», 3 и 6; «Как пользователь идёт по экрану», A (шаги 3–5), C и E;
«Экран»; «Решения по реализации», 5, 9, 11 и 12; «Вопросы владельцу», Q3 и требование владельца 2026-11-20

Кто: агент.

Не платформенный Ticket (renderer и `src/main/github/`). Глубина ревью — `medium`; снимки обеих тем в «Итог».

## Что происходит

- Start review в полосе «что дальше» — ссылка на вкладку Files GitHub (`src/renderer/pr-inbox/usePrInbox.ts:338`).
- После Ticket-ов 05–08 есть: результаты поиска и полоса «Review this pull request», diff PR в Changes (`subject` у
  `DiffPane` и `FileTree`), локальный черновик ревью с каналами `prReview.*`, канал `prReview.agentReview` и
  `prReview.stopAgent`. Образец экрана — Card Ticket-а 01.
- Требование владельца 2026-11-20: выбор, кто пишет ревью. Детали — «Решено без владельца по его требованию
  2026-11-20, подтвердить» (spec, «Решение», пункт 6).
- Q3 (а), решение владельца 2026-11-20: отметки Viewed — свои, один раз взятые с github.com (`viewerViewedState`),
  обратно не пишутся.

## Что делаем

1. Start review — кнопка с меню (Menu kit-а): Review myself и Agent review; щелчок по кнопке берёт последний выбор
   Project-а (по умолчанию Review myself); Enter на строке результата — Start review. Agent review вызывает
   `prReview.agentReview` и сразу открывает Review mode.
2. `src/renderer/pr-review/ReviewMode.tsx` (новый) на месте панели PR: список сворачивается в колонку 48 px (`← Results`
   / `← Inbox`); шапка — база ← head, head commit, файлы и `+/−`, chip одобрений, Viewed N/M, Refresh; `FileTree` и
   `DiffPane` с предметом `pr`; нити GitHub на строках; счётчик нитей и комментариев у файла в дереве.
3. Клавиши: `j` / `k` и ↑ ↓ — файлы, `n` / `p` — hunk-и, `v` — Viewed; Escape закрывает popover, второй Escape — Review
   mode (черновик остаётся).
4. Viewed: отметка по `path` и blob новой стороны (из списка файлов Ticket-а 06), снимается сама при новом blob. При
   первом открытии PR без черновика main один раз читает `files { path viewerViewedState }` (GraphQL, только чтение) и
   ставит отметки `VIEWED`; мутаций `markFileAsViewed` нет.
5. Обновление: при входе, по Refresh, при фокусе окна (старше 60 s) и раз в 2 минуты, пока Review mode открыт и окно в
   фокусе; новый head — полоса «N new commits since you started · Show new commits» (scope Since my review).
6. Смена способа: в полосе внизу — Ask the agent to add comments (черновик человека, `fill: 'add'`) и, пока Session
   пишет, «Agent is writing the review… · Stop»; у черновика агента — Take over (`prReview.stopAgent`).
7. Linked machine: Start review неактивен с tooltip «Review on the machine of the Project»; Review mode — только для
   чтения (diff, нити, без «+» и полосы ревью).
8. Состояние Review mode (PR, файл, прокрутка) живёт в store вида: смена вкладки и возврат его сохраняют
   (`docs/features/pr-inbox.md:249-250`).

## Готово, когда

- [ ] Unit `test/unit/review-mode.test.tsx` (новый): меню Start review и запоминание выбора; клавиши `j`/`k`, `n`/`p`,
      `v`, Escape; Viewed снимается при новом blob; полоса «N new commits»; Ask the agent to add comments, Stop и Take
      over вызывают нужные каналы; Read only без «+». Красный до правки — в «Итог».
- [ ] Contract `test/contract/pr-review-draft.test.ts`: отметки Viewed с github.com берутся один раз и только чтением —
      stand-in валит test на любом `--method` и `mutation`.
- [ ] e2e `test/e2e/pr-review.spec.ts` (новый) на gh stand-in и `WORFY_AGENT=fake`: Start review → Review myself из inbox
      и из поиска; Start review → Agent review — комментарии агента появляются на строках; Escape и возврат; Linked
      machine Read only; снимки в светлой и тёмной теме на 1280 и 1600 px.
- [ ] `test/unit/pr-inbox-view.test.tsx`, `test/e2e/pr-inbox.spec.ts`, `test/e2e/pr-search.spec.ts` зелёные.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/renderer/pr-review/ReviewMode.tsx` (новый), `src/renderer/pr-review/StartReviewMenu.tsx` (новый)
- `src/renderer/pr-inbox/PrInboxView.tsx`, `src/renderer/pr-inbox/usePrInbox.ts`
- `src/main/github/pr-review-draft.ts` (отметки Viewed с github.com)
- `test/unit/review-mode.test.tsx` (новый), `test/e2e/pr-review.spec.ts` (новый), `test/contract/pr-review-draft.test.ts`

Только читать: `src/renderer/changes/DiffPane.tsx`, `src/renderer/changes/FileTree.tsx` (Ticket 06),
`src/shared/ipc/pr-review.ts` (Ticket-ы 07 и 08), `src/renderer/theme/kit/`.

Образец вида — Card `card-53b21f06` («Prototype: PR search and review», Ticket 01), состояния `start`,
`myself`, `agent-writing`, `agent-done`. Состояние открывается сразу по `#state=<name>&theme=dark`.

## Вне скоупа

- «+» в gutter, popover, Pending на строке, полоса Your review со счётом и Discard — Ticket 10. Диалог Finish review —
  Ticket 11.
