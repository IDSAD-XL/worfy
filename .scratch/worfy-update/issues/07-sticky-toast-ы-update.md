# 07 — Sticky toast-ы Update: при старте, «ready», «Update failed», итог перезапуска

Type: task
Status: open
Blocked by: 03, 04
Source: решения владельца 2026-10-31, пункты 5 (один sticky toast при старте «… · Update · Later» для обоих сигналов), 7 («worfy <version> ready · Restart now · Later», «Restart when idle»), 8 («Update failed · Show log»); [spec.md](../spec.md), «Решено без владельца», Р11, Р12, «Тексты (черновик)», «Toast-ы»

## Что происходит

- Toast-ы окна — `showToast` (`src/renderer/toast/toasts.ts:131`): `action` toast остаётся до закрытия
  (`:8`), один toast на `key` (`:10`), до трёх кнопок (`:44-47`). Toast-ы при старте ставятся в
  `src/renderer/main.tsx` (например `installGettingStartedNotice`, `:9`).
- После Ticket-ов 01, 03, 04 store `src/renderer/update/store.ts` даёт `available`, `build`, `idle`,
  `harnessBehind`, `lastRestart`; каналы `update.install`, `update.restart`, `update.showLog`. Состояние
  Harness — `harness.state` и `harness.changed`, установка — `harness.install` (диалог согласия).

## Что делаем

1. `src/renderer/update/toasts.ts` (новый), `installUpdateToasts()`:
   1. При старте, один раз на запуск окна: `ready` — toast «worfy <version> ready» с «Restart now» (при
      `idle`) или «Restart when idle», и «Later»; иначе без `autoUpdate` и с Available update без `quiet` —
      «New worfy <version> available · Update · Later» (Р11). Отдельно — «Harness out of date: <from> →
      <to> · Update · Later» (`outdated` не `sameVersion` или `harnessBehind`), «Update» зовёт
      `harness.install`.
   2. Во время работы: фаза стала `ready` — toast «ready»; `idle` поменялся — кнопка toast-а «ready»
      меняется на месте (тот же `key`); `failed` — «Update failed · Show log».
   3. После «Restart when idle» — `info` toast с текстом spec-а.
   4. `lastRestart` при старте: `ok` — `success` «worfy updated to <version>…» или «worfy is back to
      <version>…»; `ok: false` — `error` с причиной. `harnessAfterUpdate: 'failed'` — «The Harness was not
      updated · Open Health».
   «Later» закрывает toast до следующего старта (Р12). Ключи: `update-available`, `update-ready`,
   `update-failed`, `harness-outdated`, `update-restart-result`.
2. `src/renderer/main.tsx`: `installUpdateToasts()` рядом с остальными toast-ами при старте.

## Готово, когда

- [x] Unit test: `ready` при старте — один toast «ready», без «available»; `idle: false` — кнопка
      «Restart when idle»; `idle` стал `true` — тот же `key`, кнопка «Restart now».
- [x] Unit test: без `autoUpdate`, Available update — toast «available»; с `autoUpdate` во время
      `building` — ни одного toast-а (Р11); `quiet` — ни одного.
- [x] Unit test: «Later» закрывает; новый снимок того же состояния в этом запуске toast не возвращает.
- [x] Unit test: `failed` — «Update failed», «Show log» зовёт `update.showLog`.
- [x] Unit test: Harness `outdated` и `harnessBehind` — toast «Harness out of date», «Update» зовёт
      `harness.install`; `sameVersion` без `harnessBehind` — нет toast-а.
- [x] e2e `update-toasts.spec.ts` (`WORFY_UPDATE=1`, заглушка, подменная сборка): при старте с готовой
      сборкой — toast «ready»; подменная сборка с кодом 1 — «Update failed».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/update-toasts.test.ts` (новый): store toast-ов и поддельный store Update.
- e2e `test/e2e/update-toasts.spec.ts` (новый).
- Сначала падающий: `ready` при старте — toast-а нет.

## Где в коде

- `src/renderer/update/toasts.ts` (новый)
- `src/renderer/main.tsx`
- `test/unit/update-toasts.test.ts` (новый)
- `test/e2e/update-toasts.spec.ts` (новый)

Только читать: `src/renderer/toast/toasts.ts`, `src/renderer/update/store.ts`, `src/shared/ipc/update.ts`,
`src/shared/ipc/harness.ts`, `test/update-stub.ts`.

## Итог

- `src/renderer/update/toasts.ts`: `createUpdateToasts` (логика над store toast-ов, без IPC) и
  `installUpdateToasts` (подписки: snapshot Update, `harness.state`/`harness.changed`, `appSettings`).
  Ключи — из тикета; ещё `update-harness-failed` (Harness после Update), `update-restart-waiting` (info после
  «Restart when idle») и `update-error` (отказ или сбой вызова кнопки, текст — причина от main).
- Ничего не показывается, пока Update выключен (`enabled: false`): dev-сборки и остальные e2e toast-ов не видят.
- Каждый toast предлагается один раз на загрузку окна для того же состояния (другая сборка, новый переход в
  `failed`, другая пара версий Harness — снова). «Update failed» показывается и при старте, если сборка уже
  `failed`.
- `lastRestart` main не очищает (`src/main/update/restart.ts` пишет его только при наличии файла результата),
  поэтому показанный `lastRestart` запоминается в localStorage окна (папка данных worfy, ADR-0005), иначе
  toast шёл бы при каждом старте. Ограничение: два одинаковых неудачных перезапуска подряд — второй без toast-а.
- Текст неудачного перезапуска в spec-е не было; добавлен в «Тексты (черновик)» spec-а этим же PR:
  «worfy was not updated to <version>: <reason>» / «worfy was not rolled back to <version>: <reason>».
- `harnessAfterUpdate` уже есть в schema на `main` (`src/shared/ipc/update.ts`); toast читает его, Ticket 05 его
  выставляет.
- Вне следа, аддитивно: `followUpdate` в `src/renderer/update/store.ts` (запуск чтения без React);
  `test/update-stub.ts` в `APP_FILES` `scripts/ci-scope.mjs` (та же строка, что у Ticket 09).
- Unit test — `test/unit/update-toasts.test.tsx`, не `.ts`: модуль тянет `settings-window.ts` с DOM, а
  `tsconfig.test.node.json` его не включает.
- e2e `test/e2e/update-toasts.spec.ts`: готовая сборка при старте — «ready», «Restart now», «Later»;
  без «Update automatically» — «available», «Update» → clone bare-репозитория, настоящий `pnpm install`
  пустого проекта, подменная сборка с кодом 1 → «Update failed» (в `build.log` — строка подменной сборки).
