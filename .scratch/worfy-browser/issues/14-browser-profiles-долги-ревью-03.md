# 14 — Browser profiles: долги ревью Ticket-а 03 и вопрос profile-а при создании Browser-а

Type: task
Status: done 2026-10-21T17:42Z
PR: #703
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

Ветка `worfy-browser/14`, база `origin/main` `657f478e`.

**Что сделано.**

1. «New browser» в меню Canvas и в Command palette кладёт profile в Node при создании: общая
   функция `newNodeData` (`src/renderer/canvas/overlays/create-items.ts`) и `newBrowserData`
   (`src/renderer/canvas/nodes/browser-frame.ts`). Один Browser profile — `data.profile` = его id,
   Browser сразу открывается под ним. Несколько, ни одного или список ещё не прочитан —
   `data.profile: null`, и выбор остаётся за рамкой «Choose a profile»: спрашивать в самом меню и в
   palette дороже (подменю в двух местах). Список profile-ов берётся из store окна
   (`browserProfilesNow`, `src/renderer/browser/profiles.ts`), который держит Browser layer; лишнего
   чтения из main нет.
   Правило «старый Browser по `data.url`» в `browserProfileChoice` теперь только для Node без ключа
   `profile`. Node с `profile: null` под него не попадает: берёт единственный profile или спрашивает.
   В комментарии записано, когда правило убрать: когда ни в одном сохранённом Layout не останется
   Browser Node без ключа `profile` (миграция Layout или каждый Canvas открыт сборкой с profile-ами,
   пока `default` был).
2. Unit-тест окна «Browser profiles…» — `test/unit/browser-profiles-window.test.tsx`: фокус окна при
   открытии и Escape; два Browser-а одного profile-а, Browser другого и Note с тем же `data.profile` —
   в строках «2 Browsers» / «1 Browser», в подтверждении удаления «2 Browsers on this Canvas use it…»;
   подзаголовок.
3. Contract-тест удаления (`test/contract/browser-profiles.test.ts`): у fake-страницы режим `goes`
   (`now` / `later` через 500 ms / `never`). Fake timers только на `setTimeout`/`clearTimeout`.
   Тест 1: хранилище стирается только после `destroyed`. Тест 2: одна страница ушла, другая висит —
   за 1999 ms ничего не стёрто, на 2000 ms (`CLOSE_PAGE_MS`) хранилище стирается. Лог fake-а теперь
   пишет и `destroyed <partition>`.
4. Ветка `storagePath` в `clearElectronPartition` (`src/main/browser/profiles.ts`) убрана: Electron
   отдаёт один объект Session на partition, сравнения по identity достаточно. Поле `storagePath`
   убрано и из mock-а Electron в contract-тесте.
5. Подзаголовок окна: «each Browser profile keeps its own cookies and logins».

e2e `test/e2e/browser-profile.spec.ts`: после «New browser» из меню при двух profile-ах Node сохранён
с `profile: null`; «New browser» из Command palette делает второй такой же Node; перед удалением
profile-а проверено, что session открытой страницы — тот же объект, что `session.fromPartition`.

**Проверки** (каждый файл отдельно, под `nice -n 10`):

- `pnpm lint` — exit 0; `pnpm typecheck` — exit 0.
- `test/contract/browser-profiles.test.ts` — exit 0 (18 tests).
- `test/unit/browser-profiles-window.test.tsx` — exit 0 (3); `test/unit/canvas-menu.test.tsx` —
  exit 0 (14); `test/unit/browser-profile-choice.test.tsx` — exit 0 (15).
- e2e под замком: `test/e2e/browser-profile.spec.ts` — exit 0 (2 passed);
  `test/e2e/browser.spec.ts -g "New browser from the Canvas menu"` — exit 0 (1 passed).

**Mutant-ы** (отдельный detached worktree, каждый — exit 1):

| Mutant | Test-файл | Exit |
| --- | --- | --- |
| окно без фильтра по `BROWSER_KIND` | browser-profiles-window | 1 |
| окно без `focus()` | browser-profiles-window | 1 |
| удаление: `resolve()` сразу после `close()`, не по `destroyed` | contract browser-profiles | 1 |
| удаление: `void Promise.all` вместо `await` | contract browser-profiles | 1 |
| удаление: без запасного таймера `CLOSE_PAGE_MS` | contract browser-profiles | 1 (timeout) |
| правило по `data.url` и для `profile: null` | browser-profile-choice | 1 |
| `newBrowserData` всегда `null` | canvas-menu | 1 |
| `newBrowserData` без ключа вместо `null` | browser-profile-choice | 1 |
| меню Canvas создаёт `data: {}` | canvas-menu | 1 |

**Не проверено.**

- Путь Command palette в unit-тесте не рендерится (`CanvasFind` тянет много хуков); он вызывает ту же
  `newNodeData`, что и меню, и проверен e2e при двух profile-ах. Palette при одном profile-е не
  проверена ни unit-, ни e2e-тестом.
- Gate fast и полный `pnpm test` не запускались (по брифу); весь `test:e2e` — gate full перед мержем.
- e2e удаления profile-а проверяет в main, что session страницы — тот же объект, что
  `session.fromPartition(...)` (Electron 44.5.1). Другие версии Electron не проверялись.

### Rework, круг 1 ревью PR #703 (глубина high: 1 high, 3 low)

**Находки и что изменено.**

1. **high — Browser layer терял разницу между «ключа `profile` нет» и `null`.** `pagesKey` в
   `BrowserLayer.tsx` писал `profile: null` и для Node без ключа. Поэтому в layer правило старого
   Browser-а по `data.url` не срабатывало, а в рамке и в окне «Browser profiles…» срабатывало.
   Последствия: при двух profile-ах старый Browser с адресом не открывал страницу; при удалённом
   `default` и одном profile-е `work` layer молча писал `work` в Node и открывал страницу не под тем
   profile-ом. Исправлено: расчёт страниц вынесен в `src/renderer/canvas/overlays/browser-pages.ts`
   (`pagesKey`, `placeBrowserPages`, `profileWrites`). Если ключа нет, в странице его тоже нет:
   `JSON.stringify` выбрасывает undefined, и после разбора ключа нет. Test
   `test/unit/browser-layer-pages.test.tsx` прогоняет данные через строку selector-а и обратно:
   - старый Browser при `default` + `admin` открывается под `default` и получает запись `default`.
     Это поведение рамки, а не «choose», как сказано в находке: «choose» бывает, когда `default`
     нет;
   - старый Browser при `work` или `work` + `admin` получает «choose (deleted)»: без страницы и без
     записи;
   - новый Browser с `profile: null` и адресом при двух profile-ах получает «choose (several)»;
   - для семи вариантов `data` и пяти наборов profile-ов layer выбирает ровно то же, что
     `browserProfileChoice` по исходным данным Node.
2. **low — `browserProfilesNow` отдавал старый список, пока новое чтение не ответило.** Теперь
   Project считается актуальным только после ответа на последнее чтение. Пока ответа нет, после
   ошибки или если пришёл только старый ответ, функция отдаёт undefined, и «New browser» пишет
   `profile: null`. Test — `test/unit/browser-profiles-store.test.tsx`.
3. **low — palette не проверялась с одним profile-ом.**
   - Новый unit-тест `test/unit/palette-new-browser.test.tsx` рендерит `CanvasFind` и вызывает
     `createCanvasNode('p1', 'browser')`. У Project p1 один profile `admin-aaaaaa`, у другого —
     `default`: Node получает `admin-aaaaaa`. При нескольких profile-ах — `null`.
   - e2e: новый test в `test/e2e/browser-profile.spec.ts` — «New browser» из palette при одном
     Default сохраняет `profile: 'default'`. Этот e2e не отличит неверный projectId: layer всё равно
     допишет `default`. Неверный projectId ловит unit-тест.
4. **low — настоящий `browserProfilesNow` в тесте меню был mock-ом.** В
   `test/e2e/browser.spec.ts` («New browser from the Canvas menu», один Default) добавлена проверка:
   сохранённый `profile` равен `'default'`.

**Проверки rework-а** (по одному файлу, `nice -n 10`): `pnpm lint` 0, `pnpm typecheck` 0;
`browser-layer-pages.test.tsx` 0 (6), `browser-profiles-store.test.tsx` 0 (4),
`palette-new-browser.test.tsx` 0 (2), `canvas-zoom.test.tsx` 0 (30), `canvas-menu.test.tsx` 0 (14),
`browser-profiles.test.ts` 0 (14), `browser-profiles-window.test.tsx` 0 (3). e2e под замком:
`browser-profile.spec.ts` 0 (3 passed), `browser.spec.ts -g "New browser from the Canvas menu"` 0.

**Mutant-ы rework-а** (detached worktree, каждый — exit 1):

| Mutant | Test-файл | Exit |
| --- | --- | --- |
| `pagesKey` снова пишет `: null` при отсутствии ключа | browser-layer-pages | 1 |
| `browserProfilesNow` отдаёт кэш при незавершённом чтении | browser-profiles-store | 1 |
| `reloadBrowserProfiles` без `current.delete` | browser-profiles-store | 1 |
| palette передаёт чужой projectId | palette-new-browser | 1 |
| palette создаёт `data: {}` | palette-new-browser | 1 |

**Ревью и merge.**
- Круг 1, глубина high (корректность, тесты, границы модулей и безопасность): REJECTED. Находки:
  1 high — Browser layer превращал отсутствующий `profile` в `null`, поэтому правило старых
  Browser-ов работало в рамке, но не в слое; 3 low. Все четыре исправлены, см. «Rework».
- Круг 2, глубина medium (корректность, тесты): VERIFIED, находок high и med нет. Три low — пробелы
  в тестах, удаление они не охраняют. Они вынесены в Ticket 15.
- Gate full зелёный на main `40c3050a` с первого прогона. Merge — `b42bdbb3` (очередь gate Session
  «Worfy продолжение»).
