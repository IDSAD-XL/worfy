# 107 — Остатки ревью PR #774: обработчик Settings без test-а, три копии проверки bridge

Type: task
Status: open
Blocked by: 103 — PR #774
Source: ревью PR #774 ([Ticket 103](103-остатки-ревью-pr-753-подписчики-меню-и-сброс-на-навигации.md)) на ПК
(строки ниже есть только на его ветке) (линзы «тесты» и «границы модулей»), направление Session на Mac 2026-10-22: оба
пункта — в один тикет, низкий приоритет. Строки — по `worfy-windows/103` `6e622d47`.

## Что происходит

1. **Обработчик команды меню `settings` ничем, кроме e2e, не закреплён.** `followMenuCommands`
   (`src/renderer/settings/settings-window.ts:51-52`) подписывает `openSettings` на команду `settings`. Мутант,
   который передаёт вместо `openSettings` пустую функцию, проходит все unit-test-ы: ревьюер прогнал
   `test/unit/menu-command.test.tsx` и `test/unit/settings-dialog.test.tsx`, оба зелёные. Test подписчика из PR
   #774 проверяет только журнал bridge (`on`, `menu.ready`, `off`) и команду не шлёт; `test/unit/shell.test.tsx`
   проверяет лишь, что команда `settings` не трогает Sidebar. Для Sidebar и Shortcuts такой мутант краснеет
   (`shell.test.tsx`, `shortcuts-overlay.test.tsx`).

2. **Проверка preload bridge скопирована в три модуля.** Одно и то же приведение
   `(globalThis as { worfy?: WorfyBridge }).worfy === undefined` стоит в:
   - `src/renderer/menu-command.ts:17`;
   - `src/renderer/shell/sidebar-visibility.ts:39`;
   - `src/renderer/settings/useAppSettings.ts:40`.

   Хозяин этого поиска — закрытая `preloadBridge()` в `src/renderer/ipc.ts:161-165`. Если preload переименует
   глобальный объект, править придётся четыре места вместо одного.

## Что делаем

1. Unit-test: после `followMenuCommands()` команда `settings` от bridge открывает окно Settings (через
   `openSettings`). Мутант «пустая функция вместо `openSettings`» — красный.
2. Экспортировать из `src/renderer/ipc.ts` одну функцию, например `hasPreloadBridge(): boolean`, и звать её в
   трёх местах пункта 2. `preloadBridge()` использует тот же поиск. Поведение не меняется.

## Готово, когда

- [ ] Test пункта 1 зелёный, мутант пункта 1 красный.
- [ ] Глобальный объект preload в `src/renderer` читает только `ipc.ts`: и
  `grep -rn "worfy?: WorfyBridge" src/renderer`, и `grep -rnE "(globalThis|window)\.worfy" src/renderer`
  находят совпадения только в `src/renderer/ipc.ts`.
- [ ] `test/unit/menu-command.test.tsx`, `settings-dialog.test.tsx`, `shell.test.tsx`, `shortcuts-overlay.test.tsx`
  зелёные; `pnpm lint`, `pnpm typecheck` — exit 0.

## Где в коде

- `src/renderer/ipc.ts:161-165` — `preloadBridge()`.
- `src/renderer/settings/settings-window.ts:51-52`, `src/renderer/menu-command.ts:17`,
  `src/renderer/shell/sidebar-visibility.ts:39`, `src/renderer/settings/useAppSettings.ts:40`.
- `test/unit/menu-command.test.tsx` — test-ы подписчиков из PR #774.

## Итог

2026-10-22, ветка `worfy-windows/107` от `main` `0437d084`, Windows-ПК.

1. **Test обработчика `settings`.** `test/unit/menu-command.test.tsx`, describe «the settings subscriber»: после
   `followMenuCommands()` команда `toggleSidebar` окно не открывает, команда `settings` открывает его на первом
   разделе (`{ open: true, section: null }`), а открытое на `GeneralSection` окно оставляет на этом разделе (по
   контракту `openSettings` без id). Мутанты в `src/renderer/settings/settings-window.ts`, все красные: пустая
   функция вместо `openSettings` — 1 (этот test); рукописный обработчик
   `() => useSettingsWindow.setState({ open: true, section: null })` — 1 (этот test); подписка на `toggleSidebar`
   вместо `settings` — 5 (menu-command 2, shell 3); `() => openSettings('GeneralSection')` — 1 (этот test).
2. **Одна проверка bridge.** `src/renderer/ipc.ts`: закрытая `lookUpPreloadBridge()` — единственное чтение
   `globalThis.worfy`; экспортирована `hasPreloadBridge(): boolean` (`!== undefined`, как в трёх копиях);
   `preloadBridge()` берёт bridge через тот же поиск и, как прежде, падает на любом ложном значении.
   `menu-command.ts`, `shell/sidebar-visibility.ts`, `settings/useAppSettings.ts` зовут `hasPreloadBridge()`;
   импорт типа `WorfyBridge` в них больше не нужен. Цикла импорта нет: `ipc.ts` импортирует только
   `shared/ipc/channels` и `toast/toasts` (а тот — только `zustand/vanilla`).
   Мутант «всегда true» — красные 7 test-ов в 4 файлах (menu-command 4, settings-dialog 1, shell 1,
   use-app-settings 1); «всегда false» — красные 34 в 5 файлах (menu-command 8, shell 14, use-app-settings 7,
   sidebar-section 3, shortcuts-overlay 2). Первое число «20» было неверным: скрипт прогона обрезал список
   упавших test-ов до 20 строк.

Проверки (все с кодом): оба grep-а «Готово, когда» находят совпадения только в `src/renderer/ipc.ts`;
`menu-command`, `settings-dialog`, `shell`, `shortcuts-overlay`, `use-app-settings`, `sidebar-section` и
`test/contract/ipc-renderer.test.tsx` — 3 прогона, 121/121, EXIT=0; `no-rmsync` EXIT=0; `pnpm lint` EXIT=0;
`pnpm typecheck` EXIT=0; gate fast — в отчёте PR. e2e не запускались (пауза владельца на окна; правка их не касается).

**Круг 3 (gate full на Mac красный).** `test/unit/adr-section.test.tsx` падал 7/7: «No "hasPreloadBridge" export
is defined on the "../../src/renderer/ipc" mock». Модуль `src/renderer/ipc` подменяют 24 файла `test/unit`
(23 через `vi.mock`, `session-node-drop.test.tsx` через `vi.doMock`); 15 из них разворачивают `importOriginal` и
получают настоящую функцию. В фабрики остальных 9 (`adr-section`, `browser-profiles-store`, `card-bridge-overlay`,
`connect-project`, `epics-section-reading`, `first-epic`, `project-settings-shell`, `signin-replies`,
`terminal-replies`) добавлено `hasPreloadBridge: () => (globalThis as { worfy?: unknown }).worfy !== undefined` —
та же проверка, что стояла в заменённых приведениях. В `test/contract` подмен этого модуля нет. Мой gate fast
этого не поймал: по diff он сузился до lint и typecheck.

Проверки: до правки `adr-section` — 7 failed, EXIT=1; 24 файла с подменой и 7 файлов тикета одним прогоном —
31 файл, 361/361, EXIT=0; все 118 файлов `test/unit/*.test.tsx`, что импортируют `src/renderer`, — 1747/1747,
EXIT=0 (весь `pnpm test` не запускался: владелец играет).
