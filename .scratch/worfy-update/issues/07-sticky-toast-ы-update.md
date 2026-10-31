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

- [ ] Unit test: `ready` при старте — один toast «ready», без «available»; `idle: false` — кнопка
      «Restart when idle»; `idle` стал `true` — тот же `key`, кнопка «Restart now».
- [ ] Unit test: без `autoUpdate`, Available update — toast «available»; с `autoUpdate` во время
      `building` — ни одного toast-а (Р11); `quiet` — ни одного.
- [ ] Unit test: «Later» закрывает; новый снимок того же состояния в этом запуске toast не возвращает.
- [ ] Unit test: `failed` — «Update failed», «Show log» зовёт `update.showLog`.
- [ ] Unit test: Harness `outdated` и `harnessBehind` — toast «Harness out of date», «Update» зовёт
      `harness.install`; `sameVersion` без `harnessBehind` — нет toast-а.
- [ ] e2e `update-toasts.spec.ts` (`WORFY_UPDATE=1`, заглушка, подменная сборка): при старте с готовой
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

Заполняется при закрытии.
