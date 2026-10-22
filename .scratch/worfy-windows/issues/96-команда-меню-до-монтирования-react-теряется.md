# 96 — Команда меню, пришедшая до монтирования React, теряется: «Settings…» сразу после показа окна не открывает Settings

Type: task
Status: open
Blocked by: —
Source: [Ticket 14](14-gate-full-на-windows.md), e2e группы 8 (`terminal-ai-settings.spec.ts`); ревью ветки
`worfy-windows/14-paths` 2026-10-22. Замер на ПК 2026-10-22, main `8f5238c8`, масштаб экрана 150 %; строки — по
коммиту `54731942`.

## Что происходит

Пункт меню «Settings…» (и его клавиши, `Ctrl+,` на Windows) отправляет команду `menu.command` в webContents окна,
для которого его нажали, или в окно с фокусом (`sendMenuCommand`, `src/main/menu.ts:55-59`). Страница слушает эту
команду только в `useEffect` окна Settings (`followMenuCommands`, `src/renderer/settings/SettingsDialog.tsx:139`),
то есть после того, как React смонтировал оболочку. Окно же показывается по `ready-to-show` или через несколько
секунд после загрузки страницы (`src/main/window.ts:160-174`) — это может быть раньше монтирования. Команда,
пришедшая в этот промежуток, никуда не попадает: Settings не открывается, ошибки нет.

На ПК e2e `test/e2e/terminal-ai-settings.spec.ts` кликал «Settings…» сразу после показа окна и терял клик в 4
прогонах из 8 (оба test-а, которые открывают Settings). На медленном ПК человек, нажавший `Ctrl+,` сразу после
появления окна, получает то же.

Ветка `worfy-windows/14-paths` обошла это в одном test-е: перед кликом он ждёт оболочку приложения (`banner`) —
0 потерь из 10. Сам промежуток до монтирования этот test больше не проверяет. Тот же ранний клик без ожидания —
ещё в шести местах e2e; падения в них не наблюдались, но держатся они на времени запуска:

- `test/e2e/helpers.ts:584` (`openMachinesSettings`);
- `test/e2e/settings.spec.ts:53`;
- `test/e2e/settings-sessions.spec.ts:45`;
- `test/e2e/session-archive.spec.ts:123`;
- `test/e2e/settings-health.spec.ts:86`;
- `test/e2e/memory.spec.ts:54`.

Не измерено: сколько длится промежуток между показом окна и монтированием на ПК и на Mac; теряются ли так другие
команды `menu.command`, кроме `settings`.

## Что делаем

Одно из двух, решение — в этом Ticket-е:
- **в приложении:** команды меню, пришедшие до подписки страницы, не теряются — main или preload держит их, пока
  renderer не подпишется, и отдаёт при подписке (или renderer подписывается до первого показа окна). Тогда
  ожидание `banner` в `terminal-ai-settings.spec.ts` убирается, и test проверяет клик сразу после показа окна;
- **только в test-ах:** `clickMenuItem` (`test/e2e/menu.ts:10`) сам ждёт, пока страница готова принять команду, и
  все семь мест выше получают это ожидание через него; гонка в приложении остаётся и записывается как известная.

## Готово, когда

- [ ] Выбран путь (приложение или test-ы), выбор и его цена записаны в Итог.
- [ ] Если путь — приложение: test открывает Settings кликом сразу после показа окна (без ожидания оболочки) и на
  ПК зелёный в `--repeat-each=10`; без починки тот же test красный.
- [ ] `terminal-ai-settings.spec.ts` и шесть мест выше — на ПК `--repeat-each=5` код 0; на Mac тот же прогон — код 0.

## Где в коде

- `src/main/menu.ts`
- `src/renderer/settings/settings-window.ts`
- `src/renderer/settings/SettingsDialog.tsx`
- `src/main/window.ts`
- `test/e2e/menu.ts`
- `test/e2e/helpers.ts`
- `test/e2e/terminal-ai-settings.spec.ts`
- `test/e2e/settings.spec.ts`
- `test/e2e/settings-sessions.spec.ts`
- `test/e2e/session-archive.spec.ts`
- `test/e2e/settings-health.spec.ts`
- `test/e2e/memory.spec.ts`

## Итог

Сделано 2026-10-22, ветка `worfy-windows/96`, от `origin/main` `d06d2c2d`.

**Путь — в приложении.** Main держит команду меню для окна, пока страница этого окна не скажет, что
следит за ней. Новый `local` канал `menu.ready` (`src/shared/ipc/menu.ts`) несёт одну команду из
`MENU_COMMANDS`. Обработчик и очередь — `src/main/ipc/menu.ts`: `sendMenuCommand`
(`src/main/menu.ts`) отдаёт команду в `deliverMenuCommand`; та шлёт сразу, если страница уже
следит за этой командой, иначе держит. `menu.ready` отдаёт удержанные команды этого вида по порядку.
В renderer три подписчика (`followMenuCommands`, `followSidebarCommand`, `followShortcutsCommands`)
идут через `followMenuCommand` (`src/renderer/menu-command.ts`): сначала подписка, потом
`menu.ready`. Порядок важен: всё, что main шлёт после ответа, застаёт слушателя.

Почему не буфер в preload или renderer. Preload по ADR-0006 не знает списка каналов, а буфер для
всех событий без подписчика менял бы смысл всех каналов (старые события состояния доходили бы
поздно). Буфер в модуле renderer не закрывает промежуток до запуска бандла: `ready-to-show` может
прийти раньше, чем выполнится module script. Цена выбранного пути: новый канал и ответ на него в
трёх подписчиках; в contract test-ах меню окно сначала говорит `menu.ready`.

**Гонка была у всех трёх команд.** `settings`, `toggleSidebar` и `shortcuts` подписываются в
`useEffect` (`SettingsDialog.tsx`, `AppShell.tsx`, `ShortcutsOverlay.tsx`). Исправлены все три.

**Устаревшая команда не срабатывает поздно:**
- удержанная команда старше `HELD_FOR_MS` (10 с) к моменту `menu.ready` отбрасывается;
- не больше `HELD_AT_MOST` (8) команд на окно, старые уходят первыми;
- новый документ главного frame (`did-start-navigation`, не same-document: View ▸ Reload, reload
  dev server) сбрасывает и удержанное, и готовность старой страницы;
- уничтоженное окно не получает ничего.

Известное ограничение (`shortcut:` в `src/main/ipc/menu.ts`): подписчик, который отписался при
живой странице, всё ещё считается готовым. Сейчас все три живут в оболочке всё время жизни
страницы.

**Test-ы.**
- `test/contract/view-menu.test.ts`, describe «a menu command chosen before the page follows it»:
  команда до подписки доходит после `menu.ready` (для каждой из трёх), готовность по командам, по
  окнам, срок, предел, сброс при навигации, уничтоженное окно, схема `menu.ready`. На product-коде
  main — 20 красных из 53 (модуля и канала нет, клик шлёт сразу), а unit test-файл ниже не
  загружается (нет `menu-command.ts`); с починкой — 53 из 53, три
  прогона.
- `test/unit/menu-command.test.tsx`: подписка раньше `menu.ready`, только своя команда, отказ main
  в консоль, без bridge — ничего.
- Мутант (в `deliverMenuCommand` команда всегда шлётся сразу): contract test — 10 красных.
- e2e `terminal-ai-settings.spec.ts` больше не ждёт `banner`: клик «Settings…» сразу после показа
  окна. С починкой `--repeat-each=10` — 20 passed, 10 skipped (test-ы с zsh, пропуск был и раньше),
  код 0. С мутантом тот же прогон — 10 failed из 20 (Settings не открылся), код 1.
- Шесть мест раннего клика (`openMachinesSettings` в `test/e2e/helpers.ts`, `settings.spec.ts`,
  `settings-sessions.spec.ts`, `session-archive.spec.ts`, `settings-health.spec.ts`,
  `memory.spec.ts`) не менялись: их чинит то же удержание в main. Шесть spec-ов с
  `terminal-ai-settings` — один прогон (11 passed, 2 skipped) и `--repeat-each=5` (55 passed,
  10 skipped), оба с кодом 0. Spec-и, которые зовут `openMachinesSettings` (`family`,
  `linked-*`), на ПК не гонялись.

Не проверено: прогон на Mac (`--repeat-each=5`) — за Mac. Гонка «reload во время монтирования»:
`menu.ready` старой страницы, пришедший после `did-start-navigation` нового документа, пометил бы
новую страницу готовой; test-а на это нет. `src/main/window.ts` из следа не менялся: показ окна
остаётся как был.
