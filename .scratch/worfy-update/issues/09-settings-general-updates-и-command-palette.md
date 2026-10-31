# 09 — Settings → General, блок «Updates», и Command palette «Update worfy»

Type: task
Status: claimed 2026-10-31T09:21Z
Branch: worfy-update/09
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

- `src/renderer/settings/UpdatesBlock.tsx` (новый): три строки `SettingRow` под строкой «Version».
  - «Updates»: строка состояния по тексту spec-а — «worfy <version>. Last checked <time>.» (время — часы
    сегодня, иначе день и часы), «worfy <version> is available.», «Building worfy <version>…», «worfy
    <version> is ready.». Кнопки: «Check now» (`update.check`, неактивна, пока идёт проверка); «Update
    worfy» при Available update (`update.install`, неактивна во время сборки); при `ready` — «Restart now»
    (`idle: true`) или «Restart when idle» (`update.restart { when }`). Под строкой: причина `skipped`
    (только после «Check now» в этом окне), отказ main, «Updates need git, node and pnpm: <missing> not
    found. See Settings → Health.», после отката — «worfy is back to <version>. Automatic updates wait for
    the next commit on main.» (текст toast-а из spec-а), во время ожидания «Restart when idle» — «worfy
    restarts when no Session is working and Autopilot has stopped».
  - «Update automatically» — `SettingSwitch`, пишет `autoUpdate` через `setAppSettings`; описание из spec-а.
  - «Roll back to previous version» — кнопка «Roll back» (`update.rollback`; нативный диалог спрашивает
    main); без `previous` — неактивна, «No previous version is kept.». Отказ показывается под строкой,
    `cancelled` — ничего.
  - `enabled: false` или snapshot ещё не пришёл — блока нет.
- Available update с `quiet` (commit, с которого откатились, Р8) считается отсутствующим: нет «is
  available» и «Update worfy», команда palette делает «Check now».
- `src/renderer/update/store.ts` — только добавлено: `updateStep()` (что значит «Update worfy» в этом
  snapshot-е), `installUpdate()` (берёт snapshot ответа), `restartIntoUpdate(when)`, `rollBackUpdate()`.
  Вынесено из компонента: правило `react-refresh/only-export-components` запрещает экспорт функций из
  `.tsx`, а palette использует те же функции.
- `src/renderer/palette/commands.ts`: «Update worfy» (группа Action, с Project-ом и без) при `enabled`;
  detail «worfy <version> available» · «ready — restart» · «check for a new version»; запуск —
  `update.restart` / `update.install` / `update.check`. Snapshot — из `CommandContext.update`, без него — из
  store окна (`useUpdateStore.getState()`), как `linked`.
- `scripts/ci-scope.mjs`: `test/update-stub.ts` добавлен в `APP_FILES` — e2e импортирует stub, и
  `test/contract/ci-workflow.test.ts:1222` требует, чтобы такой файл запускал macOS e2e на PR. Согласовано с
  Orchestrator-ом; Ticket-ы 06 и 07 добавляют ту же строку.
- Test-ы: unit `test/unit/updates-block.test.tsx` (15), `test/unit/palette-commands.test.tsx` (+6); mutant
  «Check now не зовёт `update.check`» краснеет на двух test-ах. e2e `test/e2e/update-settings.spec.ts`
  (2): GitHub — stub, Stable copy и прежняя копия — во временной папке, clone для сборки не существует;
  «Check now» → «worfy 9.9.9+b2b2b2b is available.», при выключенном переключателе `build.phase` после
  ответа проверки — `idle` и папки `update/repo` нет; откат — диалог подменён, «Cancel» → диалог показан
  один раз с текстом spec-а, прежняя копия на месте, `restart.json` нет, helper не запускался.
- Снимки обеих тем (e2e пишет их в `test-results/e2e/snapshots/09-updates-*`): available, checked,
  building, ready-busy, missing-tools, rolled-back, palette-available, palette-ready. Состояния сборки
  e2e рисует snapshot-ом, посланным в окно (`worfy:update.changed`), — только для снимков.
- Ограничение: store Update запускается первым `useUpdate()`. До Ticket-ов 06/07 (chip и toast-ы читают
  store при старте окна) команда palette появляется только после того, как Settings → General открыт.
