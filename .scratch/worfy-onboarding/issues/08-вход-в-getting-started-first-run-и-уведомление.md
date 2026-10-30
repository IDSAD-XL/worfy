# 08 — Вход в Getting started: страница трёх понятий в First run, «Start Getting started», уведомление в углу

Type: task
Status: done 2026-10-30T09:48Z
PR: #1046
Blocked by: 07
Source: решения владельца 2026-10-26, пункты 3 (существующим — одно немодальное уведомление «Open · Not now», не показывается снова; новым — кнопка «Start Getting started» в конце First run; модальных окон нет) и 4 (первая страница First run с тремя понятиями, «Next» — к проверкам); [spec.md](../spec.md), «Тексты (черновик)»; «Решено без владельца», Р7, Р8, Р9 (решено без владельца, подтверждено владельцем 2026-10-26)

## Что происходит

- First run — диалог над окном (`src/renderer/shell/FirstRun.tsx`): заголовок «First run» и строка
  (`:69-79`), список проверок, нижняя строка с «Check again» и «Close» (`:81-87`). Сам диалог уже есть
  и остаётся каким был; новых модальных окон этот Ticket не добавляет.
- Открывается сам один раз за загрузку окна, если main скажет (`askAtStartup`,
  `src/renderer/shell/first-run-store.ts:54-62`). main говорит `show: true`, когда нет отметки
  `first-run.json` или появилась новая неудачная проверка (`src/main/ipc/first-run.ts:185-194`). Ответ
  `firstRun.startup` — `{ show, report }` (`src/shared/ipc/first-run.ts:82-91`): отличить «первый раз»
  от «новая неудачная проверка» renderer не может.
- Из Command palette First run открывается всегда (`openFirstRun`, `first-run-store.ts:38-41`).
- После Ticket-ов 06 и 07: состояние Getting started с `user`, `steps`, `noticeShown`; канал
  `gettingStarted.noticeSeen`; `openGettingStarted()` в `src/renderer/getting-started/store.ts`.
- Toast-ы: `showToast` (`src/renderer/toast/toasts.ts:131`); toast `action` висит, пока его не закроют;
  кнопка закрывает его (`pressToastAction`, `:155-165`); Escape — `dismissToast` (`:147`). Регион
  toast-ов смонтирован в `src/renderer/main.tsx:88`.
- e2e First run (`test/e2e/first-run.spec.ts`) ждёт проверки сразу при открытии.

## Что делаем

1. `firstRun.startup` отвечает ещё `firstTime: boolean` — отметки `first-run.json` нет (Р8).
2. `first-run-store.ts`: поле `page: 'concepts' | 'checks'`. Открылся сам с `firstTime` — `concepts`;
   иначе (и из Command palette) — `checks`. Проверки идут в фоне уже на странице понятий.
3. `src/renderer/shell/FirstRunConcepts.tsx` (новый): заголовок, строка, три понятия, строка внизу и
   кнопка «Next» — тексты spec-а. Заголовок диалога на этой странице — «Welcome to worfy». Escape и
   «Close» работают и здесь — тогда отметка пишется, как сейчас.
4. Нижняя строка проверок: «Start Getting started» рядом с «Close» у нового пользователя, пока шаг 6
   не отмечен (Р9). Нажатие — `closeFirstRun()` и `openGettingStarted()`, фокус на разделе.
5. `src/renderer/getting-started/notice.ts` (новый), запуск один раз из `src/renderer/main.tsx`: у
   `existing` без `noticeShown` — toast `action` с ключом `getting-started-notice`, текст и кнопки
   spec-а. «Open» — `openGettingStarted()`; «Open», «Not now» и закрытие (ключ пропал из store
   toast-ов) — `gettingStarted.noticeSeen`. В следующих окнах и после перезапуска не показывается.

## Готово, когда

- [ ] Unit test страницы понятий: три понятия, «Next» → проверки; Escape закрывает.
- [ ] Unit test `askAtStartup`: `firstTime: true` — `concepts`; `show: true, firstTime: false` —
      `checks`; `openFirstRun()` — `checks`.
- [ ] Unit test уведомления: `existing` без `noticeShown` — один toast; «Not now» — `noticeSeen`;
      закрытие Escape — `noticeSeen`; `noticeShown: true` или `new` — toast-а нет.
- [ ] e2e `first-run.spec.ts` проходит со страницей понятий (шаг «Next» там, где первый старт).
- [ ] e2e: свежая папка данных — понятия → «Next» → проверки → «Start Getting started» — диалога нет,
      раздел виден и в фокусе.
- [ ] e2e: папка данных с одним Project-ом и без `getting-started.json` — First run (если открылся)
      без страницы понятий, уведомление в углу; «Not now» — после перезапуска уведомления нет, раздела
      нет.
- [ ] Снимки страницы понятий и уведомления в светлой и тёмной теме.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] green (full)` (оркестратор перед merge).

## Тесты

- Unit `test/unit/first-run-concepts.test.tsx` (новый), `test/unit/getting-started-notice.test.ts`
  (новый).
- e2e `test/e2e/first-run.spec.ts` (правка шага первого старта), `test/e2e/getting-started-entry.spec.ts`
  (новый).
- Сначала падающий: e2e свежей папки данных ждёт «Welcome to worfy» — сейчас сразу проверки.

## Где в коде

- `src/renderer/shell/FirstRun.tsx` (`:69-87`)
- `src/renderer/shell/FirstRunConcepts.tsx` (новый)
- `src/renderer/shell/first-run-store.ts` (`:38-62`)
- `src/shared/ipc/first-run.ts` (`firstRunStartup`, `:82-91`)
- `src/main/ipc/first-run.ts` (`:185-194`)
- `src/renderer/getting-started/notice.ts` (новый)
- `src/renderer/main.tsx` (`:88`)
- `test/unit/first-run-concepts.test.tsx` (новый)
- `test/unit/getting-started-notice.test.ts` (новый)
- `test/e2e/first-run.spec.ts`
- `test/e2e/getting-started-entry.spec.ts` (новый)

Только читать: `src/renderer/getting-started/store.ts`, `src/renderer/toast/toasts.ts`,
`src/renderer/shell/FirstRunChecks.tsx`.

## Итог

PR #1046 (merge b4e5c2c7). `firstRun.startup` отвечает `firstTime` (нет отметки `first-run.json` **и** пользователь
`new` — сверх тикета, по правилу владельца «существующего не заставляем»); страница трёх понятий
`FirstRunConcepts.tsx` — только когда First run открылся сам; «Start Getting started» — у нового пользователя до
шага 6; уведомление `notice.ts` — существующему без `noticeShown`, один toast. Снимки в обеих темах сверены.

- Вне следа: `src/main/getting-started/state.ts` — одна строка в `snapshotOf` (разрешено оркестратором): при
  `WORFY_GETTING_STARTED_AUTO=0` уведомление считается показанным, иначе его получал бы каждый e2e с Project-ом;
  `harness-migrate.spec.ts` (шаг «Next»), `scripts/e2e-specs.table.json`, `ci-scope-e2e.test.ts`; unit test
  уведомления — `.tsx` (импорт store ломал typecheck как `.ts`).
- Gate — VERIFIED с первого круга; CI зелёный.
- Решено без владельца, подтверждено владельцем 2026-10-30: `noticeSeen` пишется, когда toast уходит из store (как в тикете). Закрыл
  приложение, ничего не нажав, — после перезапуска уведомление покажется снова; второе окно, открытое при висящем
  toast-е, тоже его покажет. Запись в момент показа сделала бы «строго один раз».
- Debt (low): запасной путь `newUser()` (нечитаемое состояние → existing, `first-run.ts:200-205`) без test-а;
  stub `settings-health.test.tsx:104` без `firstTime` (безвредно); F-SPEC (`docs/design/F-SPEC.md:132`) не описывает
  страницу понятий.
- Windows: scope `pc` (e2e spec-ы) — gate full ПК после merge (ADR-0086).
