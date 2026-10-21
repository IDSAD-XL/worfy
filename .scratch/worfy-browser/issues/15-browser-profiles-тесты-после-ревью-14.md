# 15 — Browser profiles: пробелы в тестах после ревью Ticket-а 14

Type: task
Status: done 2026-10-21T19:33Z
PR: #707
Blocked by: 14
Source: review PR #703 (Ticket 14), круг 2, три находки low, 2026-10-21. Код — main `b42bdbb3`.

## Что происходит

1. **e2e не ловит «New browser» без profile-а.** `test/e2e/browser.spec.ts:231` («New browser from
   the Canvas menu») и e2e Command palette с одним profile-ем (`test/e2e/browser-profile.spec.ts`)
   ждут `profile: 'default'` в сохранённой Node. Проверка проходит, даже если «New browser» запишет
   `profile: null` или `data: {}`: при одном profile-е `browserProfileChoice` даёт `use` с записью,
   и Browser layer сам дописывает `default`. Unit-тесты меню (`test/unit/canvas-menu.test.tsx:62`)
   и palette (`test/unit/palette-new-browser.test.tsx`) подменяют `browserProfilesNow` mock-ом.
   Поэтому настоящую цепочку store → `newNodeData` → данные Node не проходит ни один test.
2. **Очередь ответов в test-е store не очищается.** `test/unit/browser-profiles-store.test.tsx:10-24`:
   `main.answers` общая для всех test-ов. Test, упавший посередине, оставляет неотвеченное чтение,
   и следующий test отвечает уже на него. На красном прогоне из-за этого падает лишний test, и
   причину найти труднее.
3. **Нет test-а самого компонента слоя.** Связку внутри `BrowserLayer.tsx:178-182` (`JSON.parse`,
   затем `placeBrowserPages`, затем `profileWrites`) не проверяет ни один test в случаях находки
   high Ticket-а 14: два profile-а, или удалён `default` и остался один другой profile. Чистые
   функции покрыты `test/unit/browser-layer-pages.test.tsx`. Регрессию «компонент снова приводит
   отсутствующий `profile` к `null`» ничто не поймает.

## Что делаем

1. Один unit-test меню или palette подменяет только ipc (`invoke` и событие `changed`), как
   `browser-profiles-store.test.tsx`, и берёт настоящий `browserProfilesNow`. Проверяет данные
   новой Node: с одним прочитанным profile-ем — его id; пока чтение не ответило — `null`.
2. В `browser-profiles-store.test.tsx` — `afterEach`: очередь ответов пуста (иначе test падает с
   понятным сообщением), затем очищается.
3. Test слоя Browser-ов на уровне компонента (unit с render или e2e): старый Browser (адрес, без
   ключа `profile`) при profile-ах `{work, admin}` показывает «Choose a profile», `<webview>` не
   создан, в Node ничего не записано; при `{default, admin}` открывается под `default`, и `default`
   записан.

## Готово, когда

- [ ] Mutant «меню создаёт `data: {}`» (или «`newNodeData` пишет `null` при одном profile-е») даёт
      exit 1 на test-е из пункта 1, без mock-а `browserProfilesNow`.
- [ ] Неотвеченное чтение, оставленное test-ом store, валит именно его `afterEach`, а не следующий
      test.
- [ ] Mutant «`BrowserLayer` приводит отсутствующий `profile` к `null` после `JSON.parse`» даёт
      exit 1 на test-е из пункта 3.

## Где в коде

- `test/unit/canvas-menu.test.tsx` или `test/unit/palette-new-browser.test.tsx`
- `test/unit/browser-profiles-store.test.tsx`
- `src/renderer/canvas/overlays/BrowserLayer.tsx`, `src/renderer/canvas/overlays/browser-pages.ts`
  (только чтение; правка — если для test-а нужен шов)
- новый `test/unit/browser-layer.test.tsx` или `test/e2e/browser-profile.spec.ts`

## Вне скоупа

- Поведение «New browser», выбор profile-а и удаление не меняются: только тесты.

## Итог

Ветка `worfy-browser/15`, база `origin/main` `844794fe`. Только test-ы: код приложения не менялся,
seam не понадобился.

**Что сделано.**

1. `test/unit/palette-new-browser.test.tsx` переписан: mock `browserProfilesNow` убран, подменены
   только ipc (`invoke` для `browser.profiles.list` — ответы ждут в очереди, пока test не ответит, и
   `subscribe` для `browser.profiles.changed`) и Project. Store profile-ов настоящий, его держит
   настоящий `useBrowserProfiles` (как Browser layer в приложении), так что цепочка store →
   `newNodeData` → `data` новой Node — код приложения. Случаи: один прочитанный profile — его id;
   первое чтение не ответило — `profile: null`; после ответа — id; после события `changed`, пока новое
   чтение не ответило, — снова `null` (старый список не выдаётся); несколько profile-ов — `null`.
   Каждый test — свой Project. `afterEach` валит test, оставивший неотвеченное чтение.
2. `test/unit/browser-profiles-store.test.tsx`: `afterEach` запоминает длину очереди ответов,
   очищает её и проверяет, что она была пуста, с сообщением «reads this test left unanswered (answer
   each with reply)». Очистка идёт до проверки, поэтому следующий test начинает с пустой очередью и
   при красном `afterEach`.
3. Новый `test/unit/browser-layer.test.tsx`: render `BrowserLayer` внутри React Flow в jsdom с
   настоящей рамкой `BrowserNode` и настоящим store profile-ов; подменены ipc и Project. Старый
   Browser (адрес, без ключа `profile`): при `{work, admin}` рамка показывает «Choose a profile» и
   причину «The Browser profile of this Browser was deleted.», `<webview>` и слоя нет, `apply` не
   вызван; при `{default, admin}` есть `<webview>` с partition `…-default` и адресом Node, рамка с
   `data-profile="default"`, записан ровно один `patchData` `{ profile: 'default' }`. React Flow не
   показывает неизмеренную Node (jsdom ничего не меряет), поэтому кнопка ищется по test id, а не по
   role. e2e не понадобился.

**Проверки** (каждый файл отдельно, после `wait-free.sh`, под `nice -n 10`):

- `node scripts/vitest-electron.mjs test/unit/browser-layer.test.tsx` — exit 0 (2 tests).
- `node scripts/vitest-electron.mjs test/unit/palette-new-browser.test.tsx` — exit 0 (3 tests).
- `node scripts/vitest-electron.mjs test/unit/browser-profiles-store.test.tsx` — exit 0 (4 tests).
- `pnpm lint` — exit 0; `pnpm typecheck` — exit 0.

**Mutation testing** — в отдельном detached worktree со своим `pnpm install` (он удалён
`git worktree remove --force`). Сначала тот же код без mutant-ов: все три файла exit 0.

| Mutant | Test-файл | Exit | Что упало |
| --- | --- | --- | --- |
| `newNodeData` даёт Browser-у `{}` (меню и palette создают `data: {}`) | palette-new-browser | 1 | все 3 test-а |
| `newBrowserData` пишет `null` при одном profile-е | palette-new-browser | 1 | «only profile» и «while read» |
| `browserProfilesNow` выдаёт сохранённый список, пока чтение не ответило | palette-new-browser | 1 | «while read» (после `changed`) |
| store test-1 оставляет неотвеченное чтение, с новым `afterEach` | browser-profiles-store | 1 | только test-1 (его `afterEach`), 3 других зелёные |
| то же без `afterEach` (файл как на main) | browser-profiles-store | 1 | test-2, 3, 4 — падает следующий test, а не виновный |
| `BrowserLayer` после `JSON.parse` приводит отсутствующий `profile` к `null` | browser-layer | 1 | «opens it under default» |
| `BrowserLayer` не пишет выбранный profile в Node | browser-layer | 1 | «opens it under default» |
| страница открывается и тогда, когда рамка просит выбрать profile | browser-layer | 1 | «asks for a profile» |

**Не проверено.**

- Полный `pnpm test`, gate fast и gate full не запускались (по брифу: общая нагрузка на Mac); e2e
  не нужен — изменены только unit-test-ы.
- `test/unit/canvas-menu.test.tsx` по-прежнему подменяет `browserProfilesNow`: пункт 1 закрыт test-ом
  palette (тикет разрешает «меню или palette»); меню и palette берут `data` из одной `newNodeData`.
