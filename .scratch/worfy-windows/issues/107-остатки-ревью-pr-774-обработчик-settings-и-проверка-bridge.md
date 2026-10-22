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
   разделе (`{ open: true, section: null }`). Мутант «пустая функция вместо `openSettings`» в
   `src/renderer/settings/settings-window.ts` — красный (1 failed: этот test).
2. **Одна проверка bridge.** `src/renderer/ipc.ts`: закрытая `lookUpPreloadBridge()` — единственное чтение
   `globalThis.worfy`; экспортирована `hasPreloadBridge(): boolean` (`!== undefined`, как в трёх копиях);
   `preloadBridge()` берёт bridge через тот же поиск и, как прежде, падает на любом ложном значении.
   `menu-command.ts`, `shell/sidebar-visibility.ts`, `settings/useAppSettings.ts` зовут `hasPreloadBridge()`;
   импорт типа `WorfyBridge` в них больше не нужен. Цикла импорта нет: `ipc.ts` импортирует только
   `shared/ipc/channels` и `toast/toasts` (а тот — только `zustand/vanilla`).
   Мутант «всегда true» — красные 7 test-ов (menu-command, settings-dialog, shell, use-app-settings); «всегда
   false» — красные 20 (menu-command, use-app-settings, sidebar-section, shortcuts-overlay).

Проверки (все с кодом): оба grep-а «Готово, когда» находят совпадения только в `src/renderer/ipc.ts`;
`menu-command`, `settings-dialog`, `shell`, `shortcuts-overlay`, `use-app-settings`, `sidebar-section` и
`test/contract/ipc-renderer.test.tsx` — 3 прогона, 121/121, EXIT=0; `no-rmsync` EXIT=0; `pnpm lint` EXIT=0;
`pnpm typecheck` EXIT=0; gate fast — в отчёте PR. e2e не запускались (пауза владельца на окна; правка их не касается).
