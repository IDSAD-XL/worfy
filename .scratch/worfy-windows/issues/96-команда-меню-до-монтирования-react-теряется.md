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
