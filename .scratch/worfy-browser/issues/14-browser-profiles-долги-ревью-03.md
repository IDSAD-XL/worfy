# 14 — Browser profiles: долги ревью Ticket-а 03 и вопрос profile-а при создании Browser-а

Type: task
Status: claimed 2026-10-21T15:51Z
Blocked by: 03
Source: review PR #691 (Ticket 03), круги 1 и 2, находки low, 2026-10-21. Код перечитан по main
`4a0f0ea3`.

## Что происходит

1. **«New browser» не спрашивает profile при создании.** Node создаётся с `data: {}` в двух местах:
   `src/renderer/canvas/overlays/CanvasMenu.tsx` (меню Canvas) и `src/renderer/find/CanvasFind.tsx`
   (Command palette). Пока эти файлы держал PR #682 эпика worfy-canvas, Ticket 03 сделал так: profile
   выбирает рамка (`browserProfileChoice`, `src/renderer/canvas/nodes/browser-frame.ts`). Чтобы
   отличить Browser, созданный до Ticket-а 03, от нового, рамка смотрит на web-адрес в `data.url`.
   Правило записано только в комментарии и в «Итог» Ticket-а 03.
2. **У окна «Browser profiles…» (`src/renderer/browser/BrowserProfiles.tsx`) нет unit-теста, который
   его рендерит.** Только e2e проверяет:
   - фокус окна при открытии (нужен для Escape);
   - что в `browserProfileUsage` передаются все Browser Node-ы Canvas и только они (фильтр по
     `BROWSER_KIND`). Это число — единственное предупреждение перед стиранием входа, и e2e проверяет
     только значение 1.
3. **Удаление не проверяет ожидание `destroyed`.** Mock Electron-а в
   `test/contract/browser-profiles.test.ts` шлёт `destroyed` сразу. Mutant-ы «не ждать `destroyed`»
   выживают. Путь «страница не закрылась за 2 s» (`CLOSE_PAGE_MS`) не проверен.
4. **Лишняя проверка.** Сравнение session по `storagePath` (`src/main/browser/profiles.ts:166`)
   ничего не добавляет к сравнению по identity, и тест эти ветки не различает.
5. **Текст.** В подзаголовке окна осталось голое «profile» («each profile keeps its own cookies…»).

## Что делаем

1. «New browser» в меню Canvas и в Command palette кладёт в `data.profile` единственный Browser
   profile, когда он один, или спрашивает выбор, когда их несколько. Правило по `data.url` остаётся
   только для Node-ов без `data.profile`, то есть созданных до Ticket-а 03. Это записывается
   комментарием с условием, когда правило можно убрать.
2. Unit-тест окна «Browser profiles…»:
   - два Browser-а одного profile-а и Node другого вида: в подтверждении число 2;
   - фокус окна при открытии.
3. Contract-тест удаления с отложенным `destroyed` (fake timers): хранилище стирается после
   `destroyed`. Ещё один тест: страница не закрылась за 2 s, хранилище всё равно стирается.
4. Убрать ветку `storagePath` или покрыть её тестом.
5. «profile» → «Browser profile» в подзаголовке окна.

## Готово, когда

- [ ] Новый Browser из меню и из Command palette при одном profile-е сразу открывается под ним, при
      нескольких — спрашивает. e2e или unit на создание Node.
- [ ] Unit-тест окна: mutant-ы «без фильтра по виду Node» и «без focus()» дают exit 1.
- [ ] Contract-тест: mutant-ы «не ждать `destroyed`» дают exit 1.
- [ ] `pnpm lint`, `pnpm typecheck`, тесты по файлам — exit 0.

## Где в коде

- `src/renderer/canvas/overlays/CanvasMenu.tsx`, `src/renderer/find/CanvasFind.tsx`,
  `src/renderer/canvas/nodes/create-items.ts`
- `src/renderer/canvas/nodes/browser-frame.ts`
- `src/renderer/browser/BrowserProfiles.tsx`
- `src/main/browser/profiles.ts`
- `test/unit/canvas-menu.test.tsx`, новый unit-тест окна, `test/contract/browser-profiles.test.ts`

## Вне скоупа

- `readJsonFile` (`src/main/storage/json-file.ts`) переименовывает нечитаемый файл при чтении, в
  том числе на канале `read`. Так ведут все хранилища, и так было до Ticket-а 03. Если чинить, то
  отдельно для всех.

## Итог
