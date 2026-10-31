# 06 — Version chip и кнопка Harness в toolbar: точка, акцент и меню

Type: task
Status: done 2026-10-31T10:32Z
PR: #1126
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

- [x] Unit test `UpdateChip`: нет Update — без точки и без кнопки; Available update — точка, меню из двух
      пунктов, «Update worfy» зовёт `update.install`; `quiet` — без точки; `building` — пункт неактивен;
      `ready` и `idle: false` — «Restart when idle» зовёт `update.restart { when: 'idle' }`.
- [x] Unit test `HarnessStatus`: `outdated` — кнопка с классом акцента и точкой; `sameVersion` с
      `harnessBehind` — тоже, подпись «Update Harness»; без `harnessBehind` — «Replace Harness» без акцента.
- [x] e2e `update-toolbar.spec.ts` (`WORFY_UPDATE=1`, `test/update-stub.ts`, Stable copy во временной папке,
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

- `src/renderer/update/UpdateChip.tsx` (новый) — version chip. Файл лежит не в `src/renderer/shell/toolbar/`,
  как писал Ticket: каждый `.tsx` там `Toolbar.tsx` берёт glob-ом как отдельный элемент toolbar и требует
  `order`; с chip-ом там renderer падал при старте (все e2e — пустое окно). Решено без владельца.
- Chip — та же строка `v<version>` (13px, `data-testid="app-version"`), класс `.w-toolbar__version` в `shell.css`
  вместо inline-стиля. Нет Update (`enabled: false`), нет снимка или нечего ставить — прежний `<small>` без
  кнопки. Есть Available update или сборка `building`/`ready`/`failed` — кнопка с меню (`role="menu"`, portal
  в `document.body`, вид меню Machine/Autopilot по F-SPEC). Точка акцентного цвета (`.w-update-dot`,
  `var(--accent)`) — у всего, кроме `quiet` Available update: тот остаётся кнопкой без точки, потому что
  `update.install` собирает и `quiet` (Р5 Ticket-а 03). Решено без владельца.
- Подсказки и пункты — из «Тексты (черновик)»: available — «Update worfy» (`update.install`); `failed` — тоже
  «Update worfy» (собрать снова); `building` — неактивный `aria-disabled` «Building worfy <version>…»; `ready` —
  «Restart now» при `idle`, иначе «Restart when idle» (`update.restart { when }`). «Later» только закрывает
  меню (Р12). Esc, клик мимо, потеря фокуса окна закрывают меню; стрелки ходят по пунктам. Отказ
  `update.restart` (`refused`) пишется в console: свой текст для него в spec нет, toast-ы — Ticket 07.
- `HarnessStatus.tsx`: кнопка «Update Harness» при `outdated` не `sameVersion` — класс
  `w-toolbar__icon-button--accent` (иконка цвета accent) и точка в правом верхнем углу. `sameVersion` с
  `harnessBehind` из снимка Update — та же кнопка «Update Harness: <from> → <to>» (from/to из `harnessBehind`)
  с акцентом и тем же действием; без `harnessBehind` — прежняя «Replace Harness» без акцента. Снимок
  берётся `useUpdate()` в `HarnessStatus`.
- `scripts/ci-scope.mjs`: строка `'test/update-stub.ts'` в `APP_FILES`, байт в байт как у Ticket-а 09 —
  иначе `test/contract/ci-workflow.test.ts` красный для e2e, который импортирует stub.
- e2e `test/e2e/update-toolbar.spec.ts`: bare repository как `main`, stub GitHub, Stable copy и pnpm-stand-in во
  временной папке, сборка, которая ждёт файл test-а. Проверяет: точку, tooltip, меню, «Later», «Building…»
  (пункт неактивен), «Restart now» и неизменную высоту toolbar. На Windows пропущен: stand-in pnpm
  попадает в сборку через PATH login shell, которого там нет.
- Снимки toolbar в обеих темах (none, available, building, ready, failed, quiet, «Restart when idle»,
  Harness outdated, `harnessBehind`, «Replace Harness») — в scratchpad, не в репозитории; e2e пишет свои
  `update-*-light/dark.png` в output test-а. Пункт «(вручную)» — владельцу.

- Low из review (debt, Ticket-ами не становятся): три low первого круга исправлены (меню само не открывается, e2e меряет chip, `harnessBehind` только для установленной версии). Chip перенесён в `src/renderer/update/UpdateChip.tsx`: каждый файл `shell/toolbar/` грузится как элемент toolbar. e2e `update-toolbar` пропущен на Windows (PATH сборки из registry); точка на кнопке Harness касается кольца иконки на ~1,4 px.
