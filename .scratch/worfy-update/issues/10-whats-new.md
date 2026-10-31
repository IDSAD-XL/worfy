# 10 — What's new: заголовки PR между запущенной копией и новой версией

Type: task
Status: claimed 2026-10-31T10:45Z
Branch: worfy-update/10
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

- [x] Unit test `whats-new`: три commit-а с `(#1)`, `(#2)` и без номера — две строки, новые сверху;
      250 commit-ов — `more: true` и ссылка сравнения; отдельных запросов к PR нет (счётчик заглушки).
- [x] Unit test вида: строки и ссылка; «Update worfy» зовёт `update.install`; ошибка — текст причины.
- [x] (вручную) снимки popover-а в светлой и тёмной теме.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/update-whats-new.test.ts` (новый): ответы `test/update-stub.ts`.
- Unit `test/unit/whats-new-view.test.tsx` (новый).
- Сначала падающий: commit без `(#N)` попадает в список.

## Где в коде

- `src/main/update/whats-new.ts` (новый)
- `src/shared/ipc/update.ts`, `src/main/ipc/update.ts`
- `src/renderer/update/WhatsNew.tsx` (новый)
- `src/renderer/update/UpdateChip.tsx` (chip лежит не в `shell/toolbar/`: каждый файл там — отдельный пункт toolbar, Toolbar.tsx)
- `test/unit/update-whats-new.test.ts` (новый)
- `test/unit/whats-new-view.test.tsx` (новый)

Только читать: `src/main/update/github.ts`, `test/update-stub.ts`.

## Итог

- `src/main/update/whats-new.ts`: `pullRequestsOf` берёт из `commits` сравнения первую строку, которая кончается на
  `(#<номер>)`, новые сверху; commit без номера пропускается. 250 commit-ов — `more: true`. `WhatsNewReader` делает
  одно сравнение `compare/<running>...<new>`, держит ответ для пары SHA до конца run-а, сбой (нет сети, 403/5xx, 404)
  — Error с причиной, в cache не попадает. SHA проверяются до запроса.
- Канал `update.whatsNew` (`local`), ответ `{ version, items, more, compareUrl }`; `UpdateService.whatsNew()` сравнивает
  запущенный commit со сборкой, которая идёт или готова, иначе с Available update; Update выключен или сравнивать не с
  чем — ошибка с причиной.
- `src/renderer/update/WhatsNew.tsx`: popover под chip-ом — «What's new in worfy <version>», строки «<title> #<number>»
  (номер открывает PR через `shell.openExternal`), «…and more on GitHub», кнопка — первый пункт меню chip-а («Update
  worfy», после сборки «Restart now» / «Restart when idle»). Заголовки — только текст.
- Меню chip-а: «Update worfy · What's new · Later».
- Решено без владельца: текст ожидания «Reading the pull requests on GitHub…» и пустого списка «No pull requests between
  this copy and the new version.» (в черновике текстов их нет); кнопка popover-а повторяет первый пункт меню, а не всегда
  «Update worfy» (после сборки `update.install` ничего не делает); menu и popover chip-а — над toast-ами (z-index 130
  против 120): sticky toast старта лежит прямо под chip-ом и закрывал их.
- Ревью, раунд 1: заголовок popover-а при упавшей сборке теперь — Available update, которую соберёт «Update worfy»
  (`whatsNewTarget` в `whats-new.ts` берёт сборку только в фазах building/ready, иначе `installTarget`); menu и popover
  закрываются, когда фокус уходит в другое место окна (поле Command palette на ⌘K): они выше palette; строки — ключ по
  месту (cherry-pick повторяет `(#N)`); `UPDATE_REPO` и `UPDATE_REPO_PAGE` — в `src/shared/ipc/update.ts`.
- Tests: `test/unit/update-whats-new.test.ts`, `test/unit/whats-new-view.test.tsx`; e2e `test/e2e/update-toolbar.spec.ts`
  проверяет пункт меню и popover в собранном приложении через stub. Снимки ревью (обе темы) — в scratchpad, в
  репозиторий не кладутся.
