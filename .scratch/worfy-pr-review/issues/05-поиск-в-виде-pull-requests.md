# 05 — Поиск в виде Pull requests: поле, `/`, меню области, chip-ы фильтров, сохранённые поиски, список результатов и полоса «Review this pull request»

Type: task
Status: done 2026-11-20T11:40Z
PR: #2084
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
  - evidence: test-run pass · `ELECTRON_RUN_AS_NODE=1 pnpm exec vitest run test/unit/pr-search-view.test.tsx test/unit/pr-inbox-view.test.tsx` exit 0 · mac - · 592c6239627d4575da34e3754d52f1968646fbfa
  - evidence: test-run pass · `ELECTRON_RUN_AS_NODE=1 pnpm exec vitest run test/unit/pr-search-view.test.tsx test/unit/pr-inbox-view.test.tsx` exit 0 · mac - · 4973a527eb20afe574122618af6deecf9d8e8a0b
  - evidence: review pass · PR #2084 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] e2e `test/e2e/pr-search.spec.ts` (новый) на gh stand-in: поиск → результаты со chip-ами → выбор → панель PR с
      полосой «Review this pull request» → Clear → inbox; сохранённый поиск; 422 и SSO-notice; снимки в светлой и
      тёмной теме на 1280 и 1600 px.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/pr-search.spec.ts test/e2e/pr-inbox.spec.ts` exit 0 · mac - · 592c6239627d4575da34e3754d52f1968646fbfa
  - evidence: test-run pass · `pnpm test:e2e test/e2e/pr-search.spec.ts test/e2e/pr-inbox.spec.ts` exit 0 · mac - · 4973a527eb20afe574122618af6deecf9d8e8a0b
  - evidence: review pass · PR #2084 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `test/unit/pr-inbox-view.test.tsx` и `test/e2e/pr-inbox.spec.ts` зелёные: inbox без поиска не изменился.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/pr-search.spec.ts test/e2e/pr-inbox.spec.ts` exit 0 · mac - · 592c6239627d4575da34e3754d52f1968646fbfa
  - evidence: test-run pass · `pnpm test:e2e test/e2e/pr-search.spec.ts test/e2e/pr-inbox.spec.ts` exit 0 · mac - · 4973a527eb20afe574122618af6deecf9d8e8a0b
  - evidence: review pass · PR #2084 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · 592c6239627d4575da34e3754d52f1968646fbfa
  - evidence: review pass · PR #2084 · - - · 61111661c1c832ac74077e3c914d8a6f66e4c590
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44724315407/job/136264213789 · ci - · d00f2626c703ff3471596d487ee3407372edc9fa

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

## Итог

- Красный до правки: `test/unit/pr-search-view.test.tsx` написан первым, до `SearchBar.tsx` и `SearchResults.tsx`:
  `ELECTRON_RUN_AS_NODE=1 pnpm exec vitest run test/unit/pr-search-view.test.tsx` — exit 1, 21 из 21 упали. После
  правки — 21 из 21 зелёные; вместе с `test/unit/pr-inbox-view.test.tsx` — 108 из 108, exit 0.
- Проверки на коммите 592c62396: e2e `test/e2e/pr-search.spec.ts` и `test/e2e/pr-inbox.spec.ts` целиком под
  `/tmp/worfy-e2e.lock` — 12 из 12, exit 0 (gh stand-in, `expectNoWrite`); `pnpm lint` exit 0; `pnpm typecheck` exit 0;
  `node scripts/check-feature-docs.mjs` exit 0; `node scripts/check-personal.mjs` exit 0.
- `pnpm test` — exit 1: 27 из 20108 упали в 9 файлах, все — contract test-ы слежения за файлами (cards-watch-edits,
  claude-home-registry, docs-watch-root, docs.test, harness-script-env, product-watch, profile-move,
  workflow-read-from-main, workflow-reader): на этом Mac сломан fseventsd, файлы этого PR они не трогают. Gate fast —
  exit 2, `[gate] red (fast): worfy/.:test (passed: worfy/.:lint worfy/.:typecheck)`, те же файлы. Пункт 5 «Готово,
  когда» не подтверждён: решает `ci-ok` на head PR.
- Gate предупредил: `src/renderer/pr-inbox/PrInboxView.tsx` длиннее 1000 строк (936 → 1087). Не делил: деление вида —
  отдельная правка вне Ticket-а.
- Снимки (Playwright, данные fixture, светлая и тёмная тема) — в `/tmp/worfy-night-1120/impl-prr-05/`: результаты на
  1280 и 1600 px, 422 и SSO-notice на 1280 px. В репозиторий не положены: их сначала смотрит человек; в панели виден
  временный путь профиля из fixture.
- Файл вне списка «Где в коде»: `src/renderer/pr-inbox/pr-search.css` — стили новых компонентов, только токены темы.
- Отличия от прототипа (Card `card-53b21f06`):
  1. Меню области называет «Organizations of this Project», а не одну организацию («acme (organization)»): одна
     область `owners` покрывает всех владельцев репозиториев.
  2. Раздела «Recent» в меню сохранённых поисков нет.
  3. Заголовок inbox оставлен прежним; у прототипа — «Pull requests» с кнопкой Refresh.
  4. «Searched N min ago · Refresh» — под заголовком результатов (у прототипа этой строки нет; её требует Ticket).
  5. «Load more» добавлен (требует Ticket).
  6. Строка поиска — во всю ширину над панелями, как в прототипе; Ticket говорит «над списком».
  7. Toast inbox может лечь поверх правого края строки поиска.
- Решено без владельца, подтверждено владельцем 2026-11-20:
  1. Названия области — `PR_SEARCH_SCOPE_TITLES` Ticket-а 04: This Project, Organizations of this Project, All of
     GitHub; описания — «The repositories of this Project», «Every repository of the owners of its repositories»,
     «Everything your GitHub account can see».
  2. Выбор chip-а, области (когда в поле есть текст или показан поиск) и сохранённого поиска ищет сразу, как в
     прототипе; набор текста сам не ищет. Enter в пустом поле возвращает inbox.
  3. Involves me, Reviewed by me и Asked or reviewed — кнопки-переключатели; остальные chip-ы открывают меню kit с
     вариантами и «Remove the filter».
  4. Author предлагает «Me», до 8 авторов показанных строк и «Type a login…»; у Label нет готовых вариантов, только
     «Type a label…». Оба дописывают `author:` или `label:` в поле и ставят в него фокус.
  5. Предупреждения о 256 символах и 5 операторах считаются в renderer с `repos: []`: репозиториев Project-а renderer
     не знает, поэтому деление области по запросам в нём не видно.
  6. Forget — пункт «Forget “name”» меню сохранённых поисков; он есть, только когда поле — сохранённый поиск
     пользователя и экран не Read only.
  7. Save на Linked machine с Read only — `aria-disabled` с подсказкой (`writeAction`); когда поле уже сохранено —
     «★ Saved», `aria-pressed`, неактивна.
  8. «N new since you looked» не показывается у результатов, которых нет в inbox (`unseenless`): main даёт им счётчик,
     а сбросить его может только inbox.
  9. Вход, который открывает PR (focus), снимает показанный поиск.
  10. Refresh результатов сбрасывает и кэш `prSearch.pull`: выбранный PR читается заново.
  11. Полоса своего PR в поиске — «Your pull request», «Last activity X ago.», без действия.
  12. Пустая панель — «Nothing selected: no pull request found to show here.»
  13. Рамка и текст 422 — `--span-problem` (красный).
  14. Enter на строке результата не запускает ревью (spec, раздел 12) — это Ticket 09.

### Раунд ревью 1

Каждая находка — сначала test, красный до правки: `ELECTRON_RUN_AS_NODE=1 pnpm exec vitest run
test/unit/pr-search-view.test.tsx` — exit 1, 5 из 27 упали (ровно новые test-ы находок 1, 2, 3, 4-Refresh и 5). После
правки `ELECTRON_RUN_AS_NODE=1 pnpm exec vitest run test/unit/pr-search-view.test.tsx test/unit/pr-inbox-view.test.tsx`
— exit 0, 114 из 114.

1. [med] Load more, который main отказал (пауза rate limit: ни строк, ни `cursor`), затирал первую страницу. Теперь
   такая страница оставляет число результатов, `cursor` и notice-ы показанных страниц и добавляет свои (`refused`,
   `joined` в `usePrInbox.ts`). Отказ узнаётся по `pausedUntil` или notice-у отказа, чтобы честная пустая последняя
   страница не держала Load more вечно. Test: «a Load more refused by the rate-limit pause keeps the pages shown…».
2. [med] Память `prSearch.pull` в renderer теперь по ключу `rowKey` + `updatedAt` результата: новый поиск, нашедший PR
   изменённым, читает его снова; прочитанная строка старше строки результата уступает ей. Test: «a new search that
   finds the same PR updated reads it again…».
3. [med] Фокус окна читает выбранный PR вне inbox снова (`refresh: true`), когда чтению больше 60 s (spec, решения по
   реализации, 9). Refresh результатов теперь тоже шлёт `refresh: true`. Повторное чтение со сбоем оставляет прежнюю
   строку и показывает notice. Test-ы: «the selected PR outside the inbox is read again on the window focus…»,
   «Refresh of the results reads the selected PR again, past main's memory».
4. [low] Добавлены test-ы: вход, открывающий PR inbox, снимает поиск («an entry that opens a PR of the inbox drops the
   search shown» — зелёный сразу; без `search.clear()` в коде он красный, exit 1); рамка 422 — `data-invalid="true"`
   проверяется в test-е 422 и снимается вместе с правкой текста.
5. [low] Сделано: ответ с `pausedUntil` ставит тот же запрос (и Load more) на конец паузы, не раньше чем через 1 s;
   новый поиск, Clear или уход с вида его отменяют. Test: «Enter during a rate-limit pause searches again when the pause
   ends; Clear before then cancels it» (реальный таймер 1 s).

Проверки на коде раунда: e2e `test/e2e/pr-search.spec.ts` и `test/e2e/pr-inbox.spec.ts` целиком под
`/tmp/worfy-e2e.lock` — 12 из 12, exit 0; `pnpm lint` exit 0; `pnpm typecheck` exit 0. Gate fast не запускался: на
этом Mac сломан fseventsd, и contract test-ы слежения за файлами красные без связи с этим PR.
`src/renderer/pr-inbox/PrInboxView.tsx` вырос до 1127 строк (предупреждение gate о файлах длиннее 1000 строк).
