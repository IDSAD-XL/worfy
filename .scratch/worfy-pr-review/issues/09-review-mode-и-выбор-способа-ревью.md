# 09 — Review mode и выбор способа ревью: Start review с меню Review myself / Agent review, дерево, diff, Viewed, «N new commits», смена способа, Read only

Type: task
Status: claimed 2026-11-20T16:50Z
Branch: worfy-pr-review/09
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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/review-mode.test.tsx` exit 0 (red before: exit 1) · mac - · 34f5fdbad919d13b5ee22e4b5102b243557883e8
- [ ] Contract `test/contract/pr-review-draft.test.ts`: отметки Viewed с github.com берутся один раз и только чтением —
      stand-in валит test на любом `--method` и `mutation`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-review-draft.test.ts` exit 0 (red before: exit 1, 6 failed) · mac - · 34f5fdbad919d13b5ee22e4b5102b243557883e8
- [ ] e2e `test/e2e/pr-review.spec.ts` (новый) на gh stand-in и `WORFY_AGENT=fake`: Start review → Review myself из inbox
      и из поиска; Start review → Agent review — комментарии агента появляются на строках; Escape и возврат; Linked
      machine Read only; снимки в светлой и тёмной теме на 1280 и 1600 px.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/pr-review.spec.ts test/e2e/pr-inbox.spec.ts test/e2e/pr-search.spec.ts` exit 0 · mac dev · 34f5fdbad919d13b5ee22e4b5102b243557883e8
  - evidence: screenshot pass · `../evidence/09-myself-1600-light.png` `../evidence/09-myself-1600-dark.png` `../evidence/09-agent-done-1280-light.png` `../evidence/09-agent-done-1280-dark.png` · mac dev · 34f5fdbad919d13b5ee22e4b5102b243557883e8 · scrub: 2026-11-20
  - evidence: screenshot pass · `../evidence/09-myself-1600-dark.png` dark theme · mac dev · 34f5fdbad919d13b5ee22e4b5102b243557883e8 · scrub: 2026-11-20
  - evidence: screenshot pass · `../evidence/09-agent-done-1280-light.png` Agent review done · mac dev · 34f5fdbad919d13b5ee22e4b5102b243557883e8 · scrub: 2026-11-20
  - evidence: screenshot pass · `../evidence/09-agent-done-1280-dark.png` Agent review done, dark theme · mac dev · 34f5fdbad919d13b5ee22e4b5102b243557883e8 · scrub: 2026-11-20
- [ ] `test/unit/pr-inbox-view.test.tsx`, `test/e2e/pr-inbox.spec.ts`, `test/e2e/pr-search.spec.ts` зелёные.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/pr-inbox-view.test.tsx` exit 0; `pnpm test:e2e test/e2e/pr-inbox.spec.ts test/e2e/pr-search.spec.ts` exit 0 · mac dev · 34f5fdbad919d13b5ee22e4b5102b243557883e8
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint` exit 0; `pnpm typecheck` exit 0; `pnpm test` exit 0 (ci-ok not read yet) · mac - · 34f5fdbad919d13b5ee22e4b5102b243557883e8

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

## Итог

Сделано implementer-ом 2026-11-20, ветка `worfy-pr-review/09`, от `main` 690ccdab7.

- Start review — split-кнопка с Menu kit-а (`src/renderer/pr-review/StartReviewMenu.tsx`): Review myself / Agent review;
  щелчок по кнопке берёт последний выбор Project-а (`localStorage` `worfy.prReview.how.<projectId>`, по умолчанию Review
  myself; надпись «Start review · Agent» после выбора агента). Enter на строке результата поиска — Start review.
  `nextStep` / `searchStep` (`usePrInbox.ts`) дают действие `start-review` вместо ссылки на Files GitHub.
- Review mode (`src/renderer/pr-review/ReviewMode.tsx`, состояние — `review-store.ts`, zustand) на месте панелей PR:
  список свёрнут в колонку 48 px (`← Inbox` / `← Results`, PR колонки щелчком закрывает Review mode и выбирает его);
  шапка — repo#N, база ← head, head commit, файлы и `+/−`, chip одобрений, Viewed N/M, Refresh, Close; `FileTree` и
  `DiffPane` с предметом `pr` на head PR; нити GitHub на строках; у файла в дереве — счётчик нитей и комментариев и ✓.
- Клавиши `j`/`k`, ↑/↓, `n`/`p`, `v`; Escape закрывает Review mode (popover и поля ввода не трогает); черновик остаётся.
  Смена вкладки и возврат сохраняют PR и файл.
- Viewed: отметка по `path` и blob новой стороны (`newBlob`, у удалённого файла — `deleted <oldBlob>`), снимается сама при
  новом blob. Новый канал `prReview.start` (`local`): PR без черновика получает черновик на head и один GraphQL-read
  `files { path viewerViewedState }` (страницы по 100, до 30) → отметки `VIEWED`; черновик есть — ничего не читается;
  мутаций нет (stand-in валит test на `--method` и `mutation`).
- Обновление: при входе, по Refresh, при фокусе окна (старше 60 s) и раз в 2 минуты, пока Review mode показан и окно в
  фокусе (строки inbox — `readPrInboxOnOpen`, результаты поиска — `prSearch.pull` refresh). Head ушёл от commit-а
  черновика — полоса «N new commits since you started · Show new commits» (scope `compare` от commit-а черновика).
- Полоса внизу: у черновика человека — Ask the agent to add comments (`prReview.agentReview`, `fill: 'add'`); пока
  Session пишет — «Agent is writing the review… · N comments so far», Take over и Stop (`prReview.stopAgent`); у
  черновика агента — счёт, «The agent suggests: …» и Take over. Agent review из меню: `prReview.start`, затем
  `prReview.agentReview` с `fill: 'new'`.
- Linked machine (любой уровень доступа: каналы `prReview.*` — `local`): Start review неактивен с tooltip «Review on the
  machine of the Project»; рядом **View changes** открывает Review mode только для чтения — diff и нити, без Viewed и
  полосы.
- `docs/features/pr-inbox.md`: раздел «Review mode», Linked machine, How it works, Implementation, Tests.

**Ловушка commit-а Submit (spec.md:528).** Ticket 09 не вызывает `reanchor` и не меняет `anchoredOn`/`startedOn`. Одна
функция `draftCommitOf(draft) = draft.anchoredOn ?? draft.startedOn` (`review-store.ts`) решает, на каком commit-е
нарисованы комментарии черновика, от какого commit-а считается «N new commits» и от какого — Show new commits.
Комментарии рисуются на строках diff-а, только когда scope — All changes и `draftCommitOf` равен head PR; иначе они
списком над diff-ом: «N comments on the lines of <short>, not of this diff». Submit Ticket-а 11 должен слать
`commit_id = draftCommitOf(draft)`; сейчас spec.md:528 говорит `startedOn`. Без reanchor эти два commit-а совпадают.

**Красный до правки** (src и `src/renderer/pr-review/` временно убраны, tests — новые):
- `node scripts/vitest-electron.mjs test/unit/review-mode.test.tsx` — exit 1: «Failed to resolve import
  ../../src/renderer/pr-review/ReviewMode».
- `node scripts/vitest-electron.mjs test/contract/pr-review-draft.test.ts` — exit 1, 6 failed: 5 тестов Start review
  (`handlers.get(...) is not a function`) и «every prReview channel is local» (нет `prReview.start`).

**Зелёный**, commit 34f5fdbad: unit и contract модулей (27 файлов, 586 tests) exit 0; `pnpm test:e2e
test/e2e/pr-review.spec.ts test/e2e/pr-inbox.spec.ts test/e2e/pr-search.spec.ts` exit 0 (16 passed); `pnpm test` exit 0
(875 файлов); `pnpm lint`, `pnpm typecheck` exit 0.

Снимки (обе темы): `../evidence/09-myself-1600-light.png`, `../evidence/09-myself-1600-dark.png`,
`../evidence/09-agent-done-1280-light.png`, `../evidence/09-agent-done-1280-dark.png`. Остальные (1280, поиск, агент
пишет, Linked machine) — в `test-results/worfy-pr-review-09-screens/` прогона e2e; снимок Linked machine не
закоммичен: в нём имя машины.

**Отличия от прототипа (Card `card-53b21f06`, состояния `start`, `myself`, `agent-writing`, `agent-done`):**
- Нет «+» в gutter, popover, Discard и Finish review — Ticket-ы 10 и 11; полоса внизу — только счёт, вердикт агента и
  кнопки смены способа.
- Своя строка вида (Inline / Side by side, Wrap, Hide whitespace, подсказка клавиш) вместо ScopeBar Changes; выбора scope
  нет, кроме Show new commits.
- Diff — всегда head PR; комментарии черновика на другом commit-е — списком над diff-ом, а не на строках.
- Кнопка **View changes** на Linked machine — в прототипе её нет.
- Прокрутка после возврата восстанавливается до выбранного файла, не до пикселя.
- Цвет комментария агента — `--accent` (токены `--kind-*` вне theme запрещены test-ом `node-kind-header`).

Решено без владельца, подтвердить:
- Новый канал `prReview.start` в `src/shared/ipc/pr-review.ts` (в Ticket-е «только читать»): без него main не может
  один раз прочитать Viewed при первом открытии. Следствие: Start review сразу создаёт пустой черновик, а не при первом
  комментарии. Сбой чтения Viewed — черновик без отметок, повтора нет.
- `baseRefOid` / `baseRefName` в строках PR (`src/main/github/inbox.ts`, `src/shared/ipc/pr-inbox.ts`, вне следа):
  предмету `pr` Ticket-а 06 нужен `baseOid`, и на Linked machine тоже.
- Необязательные `renderHeadEnd` у `DiffPane` и `renderRowEnd` у `FileTree` (в Ticket-е «только читать») — для Viewed
  и счётчиков вместо копии компонентов.
- Review mode показывает diff текущего head (источник GitHub Ticket-а 06 читает `pulls/{n}/files` только head) —
  частичное отличие от spec C.2.
- Linked machine — по окну (`windowMachine()`), не по уровню Read only: каналы `local` недоступны и при Full access.
- Последний выбор хранится на машине по Project-у в `localStorage`.
- Вне следа по необходимости: `scripts/e2e-specs.table.json` (pr-review.spec.ts связывает две машины — правило link),
  `test/unit/pr-search-view.test.tsx` и `test/e2e/pr-search.spec.ts` (Start review больше не ссылка на Files),
  `test/fixtures/gh/gh-stub.mjs` (ответ на `viewerViewedState`).
