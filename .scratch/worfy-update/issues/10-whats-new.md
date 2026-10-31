# 10 — What's new: заголовки PR между запущенной копией и новой версией

Type: task
Status: open
Blocked by: 01, 06
Source: решения владельца 2026-10-31, пункты 6 (пункт «What's new» в меню version chip-а), 10 (заголовки PR, влитых между копией и новой версией, с GitHub; без changelog); [spec.md](../spec.md), «Решено без владельца», Р13, «Тексты (черновик)», «What's new»

## Что происходит

- Клиент GitHub API Ticket-а 01 (`src/main/update/github.ts`) читает сравнение `compare/<a>...<b>`; его
  `commits` (до 250) несут сообщения commit-ов. PR вливаются squash merge-ем: первая строка — заголовок PR и
  `(#<номер>)` (например `773915d8 docs: 2026-10-30 results: … (#1063)`).
- Меню version chip-а — `src/renderer/shell/toolbar/UpdateChip.tsx` (Ticket 06): «Update worfy», «Later».

## Что делаем

1. `src/main/update/whats-new.ts` (новый): из `commits` сравнения запущенного commit-а с Available update —
   строки `{ title, number }` по Р13, новые сверху; commit без `(#N)` пропускается. 250 commit-ов —
   `more: true` и ссылка на страницу сравнения `https://github.com/IDSAD-XL/worfy/compare/<a>...<b>`.
   Ответ кэшируется на SHA; нет сети — ошибка с причиной.
2. Канал `update.whatsNew` (`local`), ответ `{ version, items, more, compareUrl }`.
3. `src/renderer/update/WhatsNew.tsx` (новый): popover под chip-ом — заголовок, строки «<title> #<number>»
   (номер — ссылка на PR, открывается в браузере системы), «…and more on GitHub», кнопка «Update worfy».
4. `UpdateChip.tsx`: пункт «What's new» между «Update worfy» и «Later».

## Готово, когда

- [ ] Unit test `whats-new`: три commit-а с `(#1)`, `(#2)` и без номера — две строки, новые сверху;
      250 commit-ов — `more: true` и ссылка сравнения; отдельных запросов к PR нет (счётчик заглушки).
- [ ] Unit test вида: строки и ссылка; «Update worfy» зовёт `update.install`; ошибка — текст причины.
- [ ] (вручную) снимки popover-а в светлой и тёмной теме.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/update-whats-new.test.ts` (новый): ответы `test/update-stub.ts`.
- Unit `test/unit/whats-new-view.test.tsx` (новый).
- Сначала падающий: commit без `(#N)` попадает в список.

## Где в коде

- `src/main/update/whats-new.ts` (новый)
- `src/shared/ipc/update.ts`, `src/main/ipc/update.ts`
- `src/renderer/update/WhatsNew.tsx` (новый)
- `src/renderer/shell/toolbar/UpdateChip.tsx`
- `test/unit/update-whats-new.test.ts` (новый)
- `test/unit/whats-new-view.test.tsx` (новый)

Только читать: `src/main/update/github.ts`, `test/update-stub.ts`.

## Итог

Заполняется при закрытии.
