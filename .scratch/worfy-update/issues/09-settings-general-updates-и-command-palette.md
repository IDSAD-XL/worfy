# 09 — Settings → General, блок «Updates», и Command palette «Update worfy»

Type: task
Status: open
Blocked by: 03, 04
Source: решения владельца 2026-10-31, пункты 6 (Settings → General «Updates»: «Check now», «Update automatically»; Command palette «Update worfy»), 7 (по умолчанию включено), 9 («Roll back to previous version»); [spec.md](../spec.md), «Решено без владельца», Р8, «Тексты (черновик)», «Settings → General → Updates», «Command palette»

## Что происходит

- Settings → General (`src/renderer/settings/GeneralSection.tsx`, `order` 10, `:12`): масштаб, память,
  строка «Version» (`:133-137`). Строки и переключатели — `SettingRow`, `SettingSwitch`
  (`src/renderer/settings/controls.tsx`); настройки — `useAppSettings`, `setAppSettings`.
- Command palette — `src/renderer/palette/commands.ts`; соседние команды без Project-а — «First-run
  checks» (`:304`), «Getting started» (`:317`).
- После Ticket-ов 03 и 04: поле `autoUpdate`, каналы `update.check`, `update.install`, `update.restart`,
  `update.rollback`, `update.showLog`; в состоянии — `previous`, `rolledBackFrom`, `lastCheck`.

## Что делаем

1. `src/renderer/settings/UpdatesBlock.tsx` (новый) — блок «Updates» под строкой «Version»: строка
   состояния и кнопки «Check now» (`update.check`; во время проверки неактивна; `skipped` — причина под
   строкой), «Update worfy» (Available update — `update.install`; `ready` — «Restart now» или «Restart when
   idle»); переключатель «Update automatically» (`autoUpdate`); «Roll back to previous version»
   (`update.rollback`; без `previous` — неактивна с текстом spec-а); при `missing` — строка с
   инструментами. После отката — строка про `rolledBackFrom`. Без Update (`enabled: false`) блока нет.
2. `GeneralSection.tsx`: блок под строкой «Version».
3. `commands.ts`: «Update worfy» при `enabled` — detail по состоянию (тексты spec-а); без Available update
   команда делает `update.check`; `ready` — `update.restart` (`now` или `idle`).

## Готово, когда

- [ ] Unit test блока: «Check now» зовёт `update.check`; переключатель пишет `autoUpdate: false`; без
      `previous` откат неактивен; `ready` и `idle: false` — «Restart when idle»; `enabled: false` — блока
      нет.
- [ ] Unit test команд: при `enabled` есть «Update worfy»; без Update — `update.check`; `ready` —
      `update.restart`; при `enabled: false` команды нет.
- [ ] e2e `update-settings.spec.ts` (`WORFY_UPDATE=1`, заглушка): «Check now» — строка «worfy <version> is
      available.»; переключатель выключен — сборка сама не идёт; откат с «Cancel» в диалоге (подменённый
      диалог) — ничего.
- [ ] (вручную) снимки блока в светлой и тёмной теме.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/updates-block.test.tsx` (новый), `test/unit/palette-commands.test.tsx`.
- e2e `test/e2e/update-settings.spec.ts` (новый).
- Сначала падающий: «Check now» не зовёт `update.check`.

## Где в коде

- `src/renderer/settings/GeneralSection.tsx` (`:133-137`)
- `src/renderer/settings/UpdatesBlock.tsx` (новый)
- `src/renderer/palette/commands.ts` (`:304`, `:317`)
- `test/unit/updates-block.test.tsx` (новый)
- `test/unit/palette-commands.test.tsx`
- `test/e2e/update-settings.spec.ts` (новый)

Только читать: `src/renderer/settings/controls.tsx`, `src/renderer/settings/useAppSettings.ts`,
`src/renderer/update/store.ts`, `src/shared/ipc/update.ts`, `test/update-stub.ts`.

## Итог

Заполняется при закрытии.
