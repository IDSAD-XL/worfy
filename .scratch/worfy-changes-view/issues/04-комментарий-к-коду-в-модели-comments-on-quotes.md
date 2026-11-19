# 04 — Комментарий к коду в модели Comments on quotes: хранилище `v: 3`, текст для агента, блок в пузыре

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», 4; «Решения по реализации — часть 1» → «Комментарии к строкам», пункты
«Модель», «Хранилище», `agentText`, «Код в цитате», «После Refresh»; «Решения по test-ам — часть 1», seam 1;
«Решено без владельца», 7 и 9

Кто: агент.

Не платформенный Ticket (renderer). Глубина ревью — `medium`: смена схемы хранилища неотправленных комментариев.

## Что происходит

- Comments on quotes работают только на тексте ответа агента (`docs/features/sessions.md:220-254`). Модель —
  `src/renderer/session/quote-comments.ts`: `QuoteComment` (`:43`), пределы картинок `COMMENT_IMAGES` и
  `MESSAGE_IMAGES` (`:31`, `:33`), `QUOTE_FOR_AGENT` (`:37`), `anchorRange` (`:132`), `agentText` (`:189`),
  `parseQuoted` (`:229`), `composeRound` (`:308`).
- Хранилище — `src/renderer/session/quote-store.ts`: ключ `quoteKey` (`:39`), схема записи `v: 2` (`:49`), запись —
  `:102`; оно в localStorage окна, в папке данных worfy (`docs/features/storage-and-diagnostics.md:74`).
- Лоток поля ввода — `src/renderer/session/QuoteComments.tsx`; блок цитаты в сообщении пользователя —
  `src/renderer/session/QuotedPrompt.tsx`.

## Что делаем

1. `QuoteComment` получает вариант `code`: путь, репозиторий, сторона (`old` или `new`), первая и последняя строка,
   текст строк, commit (или `uncommitted`) и предмет (`{ ticket: epic, NN }`), а также worktree и ветка для заголовка
   раздела. Пределы картинок те же.
2. Хранилище — схема `v: 3` с вариантом `code`; запись `v: 2` читается как есть и переписывается в `v: 3` при
   следующей записи.
3. `agentText` пишет второй раздел «Comments on lines of the diff (N), worktree …, branch …:» — пример в spec-е
   («Решения по реализации — часть 1» → «Комментарии к строкам»); `parseQuoted` читает его обратно. Правила
   `composeRound` не меняются.
4. Код в цитате — до 6 строк; длиннее режется в середине с «…».
5. Чистая функция `anchorLines` — поиск строки комментария заново в новом тексте файла: ближайшее совпадение к старому
   месту, как `anchorRange`; нет строки — пометка «Line changed».
6. Лоток поля ввода Session view: «N comments · M on code»; chip комментария к коду показывает `путь:строки`.
7. Блок комментария к коду в сообщении пользователя: путь, строки, код (свёрнут до трёх строк, «Show all»),
   комментарий и картинки — из текста сообщения, поэтому тот же после рестарта. Переход к строке в Changes — Ticket 05.
8. Английская страница `docs/features/sessions.md`, раздел Comments on quotes: комментарии к коду из Changes в том же
   лотке, текст для агента, блок в пузыре. Перевод — Ticket 06.

## Готово, когда

- [ ] Unit test (`test/unit/quote-comments.test.ts`): `agentText` с комментариями к коду и к сообщениям вместе;
      `parseQuoted` читает оба раздела обратно; цитата кода длиннее 6 строк режется в середине.
- [ ] Unit test: `anchorLines` находит сдвинутую строку и даёт «Line changed», когда строки нет.
- [ ] Unit test (`test/unit/quote-store.test.tsx`): запись `v: 2` читается, записывается `v: 3`; комментарий к коду
      переживает перечтение хранилища.
- [ ] Unit test (`test/unit/quote-comments-ui.test.tsx`): лоток «N comments · M on code», блок кода в пузыре.
- [ ] Английская страница `docs/features/sessions.md` описывает комментарии к коду; `node scripts/check-feature-docs.mjs`
      — exit 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/renderer/session/quote-comments.ts:31-43`, `:132`, `:189`, `:229`
- `src/renderer/session/quote-store.ts:39`, `:44-49`, `:102`
- `src/renderer/session/QuoteComments.tsx`, `src/renderer/session/QuotedPrompt.tsx`,
  `src/renderer/session/QuoteCommentParts.tsx`
- `test/unit/quote-comments.test.ts`, `test/unit/quote-store.test.tsx`, `test/unit/quote-comments-ui.test.tsx`
- `docs/features/sessions.md:220-254`

Только читать: `src/renderer/session/quote-comments.ts:308` (`composeRound` не меняется).

## Вне скоупа

- «+» в gutter, popover, лоток Node-а Changes, «To», Send из Changes, переход из пузыря к строке — Ticket 05.
