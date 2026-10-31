# 06 — Version chip и кнопка Harness в toolbar: точка, акцент и меню

Type: task
Status: open
Blocked by: 03, 04
Source: решения владельца 2026-10-31, пункты 5 (акцентная кнопка с точкой для обоих сигналов), 6 (version chip с точкой, меню «Update worfy · What's new · Later»); [spec.md](../spec.md), «Решено без владельца», Р11, Р12, «Тексты (черновик)», «Version chip», «Кнопка Harness»

## Что происходит

- Версия — вторая строка элемента Harness в toolbar: `<small>` с `v{version}` без действий
  (`src/renderer/shell/toolbar/HarnessStatus.tsx:102-106`).
- Кнопка Harness — `IconButton` (`:73`) с действием Update Harness для `outdated` (`:146-156`); вид
  кнопок — `.w-toolbar__icon-button` (`src/renderer/shell/shell.css`). Акцента и точки нет.
- После Ticket-ов 01, 03, 04 store `src/renderer/update/store.ts` даёт `available`, `build`, `idle`,
  `harnessBehind`; каналы `update.install`, `update.restart`.

## Что делаем

1. `src/renderer/shell/toolbar/UpdateChip.tsx` (новый): version chip вместо `<small>` — та же строка и
   размер, кнопка. Есть Available update без `quiet` или `ready`/`failed` — точка акцентного цвета и
   подсказка из «Тексты (черновик)». Нажатие — меню: «Update worfy» (`update.install`; при `ready` —
   «Restart now» при `idle`, иначе «Restart when idle»; при `building` — неактивный пункт), «Later»
   (закрывает меню, Р12). Без Update (`enabled: false`) chip — прежний текст без кнопки. Пункт «What's
   new» добавит Ticket 10.
2. `HarnessStatus.tsx`: при `outdated` не `sameVersion`, а также при `harnessBehind` — кнопка Harness
   акцентная, с точкой; подпись и действие — прежние «Update Harness» (диалог согласия). `sameVersion` без
   `harnessBehind` — как сейчас «Replace Harness», без акцента.
3. Стили точки и акцента — `shell.css`, токены темы; снимки в светлой и тёмной теме.

## Готово, когда

- [ ] Unit test `UpdateChip`: нет Update — без точки и без кнопки; Available update — точка, меню из двух
      пунктов, «Update worfy» зовёт `update.install`; `quiet` — без точки; `building` — пункт неактивен;
      `ready` и `idle: false` — «Restart when idle» зовёт `update.restart { when: 'idle' }`.
- [ ] Unit test `HarnessStatus`: `outdated` — кнопка с классом акцента и точкой; `sameVersion` с
      `harnessBehind` — тоже, подпись «Update Harness»; без `harnessBehind` — «Replace Harness» без акцента.
- [ ] e2e `update-toolbar.spec.ts` (`WORFY_UPDATE=1`, `test/update-stub.ts`, Stable copy во временной папке,
      подменная сборка Ticket-а 03): точка появилась, меню, «Update worfy» — подсказка «Building…», потом
      «Restart now».
- [ ] (вручную) снимки toolbar в светлой и тёмной теме: точка видна, высота toolbar не изменилась.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/update-chip.test.tsx` (новый), `test/unit/harness-status.test.tsx`.
- e2e `test/e2e/update-toolbar.spec.ts` (новый).
- Сначала падающий: Available update в store — точки на chip-е нет.

## Где в коде

- `src/renderer/shell/toolbar/HarnessStatus.tsx` (`:73`, `:102-106`, `:146-156`)
- `src/renderer/shell/toolbar/UpdateChip.tsx` (новый)
- `src/renderer/shell/shell.css`
- `test/unit/harness-status.test.tsx`
- `test/unit/update-chip.test.tsx` (новый)
- `test/e2e/update-toolbar.spec.ts` (новый)

Только читать: `src/renderer/update/store.ts`, `src/shared/ipc/update.ts`, `test/update-stub.ts`.

## Итог

Заполняется при закрытии.
