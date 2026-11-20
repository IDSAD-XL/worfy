# 05 — Поиск в виде Pull requests: поле, `/`, меню области, chip-ы фильтров, сохранённые поиски, список результатов и полоса «Review this pull request»

Type: task
Status: claimed 2026-11-20T09:18Z
Blocked by: 01, 03, 04
Source: [spec.md](../spec.md), «Ticket-ы», 5; «Решение», 1 и 2; «Как пользователь идёт по экрану», A (шаги 1–3);
«Экран»; «Решения по реализации», 1, 9, 10 и 12; «Вопросы владельцу», Q1

Кто: агент.

Не платформенный Ticket (renderer, документ Feature). Глубина ревью — `medium`; снимки обеих тем в «Итог».

## Что происходит

- Вид Pull requests показывает группы inbox, строку PR и панель выбранного PR (`docs/features/pr-inbox.md:11-122`,
  `src/renderer/pr-inbox/PrInboxView.tsx`). Строки поиска нет.
- После Ticket-а 04 main ищет (`prSearch.run`, `prSearch.pull`, сохранённые поиски); после Ticket-а 03 у строки есть
  chip одобрений. Образец экрана — Card Ticket-а 01.
- Полоса «что дальше» Needs my review даёт Start review ссылкой на вкладку Files GitHub
  (`src/renderer/pr-inbox/usePrInbox.ts:338`). Полосы для чужого PR вне inbox нет.

## Что делаем

1. Над списком — поле `role="searchbox"` «Search pull requests»; `/` фокусирует его из любого места вида, кроме
   текстового поля; Enter ищет; Escape снимает фокус; предупреждение main (256 символов, 5 операторов) — под полем.
2. Меню области: This Project (по умолчанию), организации Project-а, All of GitHub (Q1 (а)). Chip-ы фильтров State,
   Review requested, Author, Involves me, Label, Draft, Review status, Reviewed by me, Asked or reviewed — пишут
   квалификаторы в то же поле; поле — единственный источник правды.
3. Список «Search · N results» вместо групп: та же строка, что в inbox, с chip-ом одобрений; ↑ ↓ — как в inbox; первый
   результат выбран сам; «Load more»; «Searched 3 min ago · Refresh» без таймера; Clear (×) возвращает группы inbox.
4. Сохранённые поиски — «☆ Save» и меню поля; два встроенных; на Linked machine Read only Save неактивен.
5. Выбор результата → та же панель PR (PR вне inbox — через `prSearch.pull`); полоса чужого PR — «Review this pull
   request» с кнопкой Start review. До Ticket-а 09 кнопка ведёт, как сейчас, на вкладку Files GitHub.
6. Ошибки раздела 10 spec-а — строкой над результатами или под полем (422 — красная рамка).
7. `docs/features/pr-inbox.md`: раздел о поиске (английский; перевод — Ticket 12).

## Готово, когда

- [ ] Unit `test/unit/pr-search-view.test.tsx` (новый): `/` фокусирует поле и не срабатывает в текстовом поле; chip
      пишет квалификатор в поле и показывает уже записанный; меню области; Clear возвращает группы; notice-ы ошибок.
      Красный до правки — в «Итог».
- [ ] e2e `test/e2e/pr-search.spec.ts` (новый) на gh stand-in: поиск → результаты со chip-ами → выбор → панель PR с
      полосой «Review this pull request» → Clear → inbox; сохранённый поиск; 422 и SSO-notice; снимки в светлой и
      тёмной теме на 1280 и 1600 px.
- [ ] `test/unit/pr-inbox-view.test.tsx` и `test/e2e/pr-inbox.spec.ts` зелёные: inbox без поиска не изменился.
- [ ] `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/renderer/pr-inbox/SearchBar.tsx` (новый), `src/renderer/pr-inbox/SearchResults.tsx` (новый)
- `src/renderer/pr-inbox/PrInboxView.tsx`, `src/renderer/pr-inbox/usePrInbox.ts`
- `docs/features/pr-inbox.md`
- `test/unit/pr-search-view.test.tsx` (новый), `test/e2e/pr-search.spec.ts` (новый)

Только читать: `src/shared/ipc/pr-search.ts` (Ticket 04), `src/renderer/pr-inbox/ApprovalsChip.tsx` (Ticket 03),
`src/renderer/theme/kit/`, `test/e2e/pr-inbox.spec.ts` (образец stand-in-а).

Образец вида — Card `card-53b21f06` («Prototype: PR search and review», Ticket 01), состояния `search`,
`inbox`, `scope`, `saved`, `savepop`, `filter`. Состояние открывается сразу по `#state=<name>&theme=dark`.

## Вне скоупа

- Review mode и выбор способа ревью — Ticket 09. Уведомления о новых результатах сохранённого поиска — вне Epic-а.
