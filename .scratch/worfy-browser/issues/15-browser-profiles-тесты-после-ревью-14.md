# 15 — Browser profiles: пробелы в тестах после ревью Ticket-а 14

Type: task
Status: claimed 2026-10-21T17:43Z
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
