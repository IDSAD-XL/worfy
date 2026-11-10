# 96 — Pull requests: две панели по прототипу B

Type: feature
Status: claimed 2026-11-10T09:59Z
Blocked by: —
Source: владелец 2026-11-10 — вид «Pull requests» (Epic worfy-pr-inbox) выглядит бледно; из кликабельного прототипа
с вариантами A / B / C (карточка `card-38855775`, `index.html` в папке карточек Project-а) выбран вариант **B**.

## Что происходит

Вид «Pull requests» (`src/renderer/pr-inbox/PrInboxView.tsx`) — столбец из пяти рамок групп, у каждой строки PR две
строки текста; строка раскрывается щелчком и показывает нити ревью и черновики ответов. На широком окне справа
пустое место, у владельца обычно 1–3 PR — вид почти пуст и не говорит, что делать дальше. Размер PR (+/−) не
читается: в `PrInboxRow` (`src/shared/ipc/pr-inbox.ts:49-77`) нет `additions` и `deletions`.

## Что делаем

Вариант B прототипа, на токенах приложения (`src/renderer/theme/tokens.css`), обе темы:

- **Две панели.** Слева — компактный список открытых PR Project-а по тем же группам и в том же порядке
  (`PR_INBOX_GROUPS`), только группы, где есть PR; у строки — аватар автора (инициалы), заголовок, `name#N`,
  chip Ticket-а, точка CI (с текстом, когда CI не зелёный), возраст с цветом «сколько ждёт», число открытых нитей,
  точка «new». Справа — выбранный PR целиком: заголовок, `owner/repo#N`, chip Ticket-а, Draft / via team, автор,
  ветка, «N new since you looked»; плашка «что сделать дальше» (чистая функция от группы, CI, review и черновиков);
  четыре ячейки CI / Review / Merge / Size (+a −d с полосой); Open on GitHub, Draft replies, Mark seen; заголовок
  «Threads N open · M resolved» и нити с черновиками ответов (Send / Discard / Ask the Session to rewrite, Send all) —
  те же компоненты `DraftThread.tsx`.
- **Выбор.** Щелчок по строке выбирает PR; ↑/↓ двигают выбор по списку (не в поле ввода, не в диалоге, только пока
  вид показан). Выбор пользователя (щелчок, клавиша, вход на PR) отмечает PR просмотренным, как раньше раскрытие
  строки; выбор, который вид делает сам (первый PR при открытии), не отмечает.
- **Черновики** читаются только у выбранного PR (правая панель), как раньше у раскрытой строки. Счёт черновиков по
  всем PR не нужен.
- **Размер PR.** `additions` и `deletions` — два поля запроса деталей PR в main (`src/main/github/inbox.ts`,
  `PULL_FIELDS`), в `PrInboxRow` — `number | null`.
- **Пустые состояния.** Один PR — он выбран, правая панель показывает его. Нет PR — спокойное пустое состояние вместо
  панелей. Узкое окно — панели одна под другой.
- Не делаем: полосу счётчиков варианта A, доску варианта C.

Остаётся всё поведение Ticket-ов 03–07 Epic-а worfy-pr-inbox: Send только по щелчку пользователя, main перепроверяет
и отправляет ровно показанный текст, guard-ы, раздел sidebar, badge Ticket-а, уведомления.

## Готово, когда

- [ ] Вид — две панели по прототипу B: список слева по группам, выбранный PR справа с плашкой «что дальше»,
      ячейками CI / Review / Merge / Size, нитями и черновиками.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/pr-inbox.spec.ts test/e2e/checks-badges.spec.ts` exit 0 (12 passed) · mac - · 1bffac678d5555d978c3aa09c341b44b2b167f77
- [ ] ↑/↓ двигают выбор; щелчок и клавиша отмечают PR просмотренным; выбор вида при открытии — нет.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/pr-inbox-view.test.tsx test/unit/pr-inbox-groups.test.ts test/contract/pr-inbox.test.ts` and the other pr-inbox unit and contract files exit 0 (282 passed) · mac - · 1bffac678d5555d978c3aa09c341b44b2b167f77
- [ ] `additions` / `deletions` читаются в main и видны в ячейке Size; в test-ах — только stub-ы.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/pr-inbox-view.test.tsx test/unit/pr-inbox-groups.test.ts test/contract/pr-inbox.test.ts` and the other pr-inbox unit and contract files exit 0 (282 passed) · mac - · 1bffac678d5555d978c3aa09c341b44b2b167f77
- [ ] Один PR и ни одного PR выглядят задуманно: один выбран; пусто — спокойное пустое состояние.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/pr-inbox.spec.ts test/e2e/checks-badges.spec.ts` exit 0 (12 passed) · mac - · 1bffac678d5555d978c3aa09c341b44b2b167f77
- [ ] Unit test-ы вида и e2e `test/e2e/pr-inbox.spec.ts` обновлены; новые e2e: выбор PR показывает справа его нити и
      черновик; ↑/↓ двигают выбор; Send из правой панели отправляет только по щелчку (log gh stub-а).
  - evidence: test-run pass · `pnpm test:e2e test/e2e/pr-inbox.spec.ts test/e2e/checks-badges.spec.ts` exit 0 (12 passed) · mac - · 1bffac678d5555d978c3aa09c341b44b2b167f77
- [ ] Снимки Playwright 1280 и 1600 px, светлая и тёмная тема.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/pr-inbox.spec.ts test/e2e/checks-badges.spec.ts` exit 0 (12 passed) · mac - · 1bffac678d5555d978c3aa09c341b44b2b167f77
- [ ] `docs/features/pr-inbox.md` и `docs/features/ru/pr-inbox.md` описывают две панели.
  - evidence: commit pass · Pull requests view: two panes, the selected PR in full (worfy-polish 96) · - - · 1bffac678d5555d978c3aa09c341b44b2b167f77
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 1bffac678d5555d978c3aa09c341b44b2b167f77

## Где в коде

- `src/renderer/pr-inbox/PrInboxView.tsx` — разметка двух панелей, выбор, ↑/↓.
- `src/renderer/pr-inbox/usePrInbox.ts` — чистые функции: порядок строк, «что дальше», размер, состояние merge.
- `src/renderer/pr-inbox/pr-inbox.css` — стили панелей.
- `src/renderer/pr-inbox/DraftThread.tsx` — только вид: рамка черновика и основная кнопка Send, поведение то же.
- `src/shared/ipc/pr-inbox.ts` — `additions`, `deletions` в `prInboxRowSchema`.
- `src/main/github/inbox.ts`, `src/main/github/inbox-groups.ts` — поля запроса и `InboxPull`.
- `test/unit/pr-inbox-view.test.tsx`, `test/unit/pr-inbox-groups.test.ts`, `test/unit/pr-inbox-notices.test.ts`,
  `test/unit/review-threads-badge.test.tsx`, `test/unit/pipeline-board.test.tsx`, `test/contract/pr-inbox.test.ts`,
  `test/e2e/pr-inbox.spec.ts`, `test/e2e/checks-badges.spec.ts` (badge открывает вид на PR: теперь PR выбран, а не
  строка раскрыта).
- `docs/features/pr-inbox.md`, `docs/features/ru/pr-inbox.md`.

## Итог
