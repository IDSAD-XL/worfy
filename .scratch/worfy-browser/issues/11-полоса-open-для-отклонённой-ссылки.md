# 11 — Полоса «The page wants to open … — Open» для ссылки, которую Browser не открыл сам

Type: task
Status: open
Blocked by: 10
Source: решение владельца 2026-10-20 («10 окей» на вариант (b) в чате Session «Worfy продолжение»);
review PR #609 (Ticket 10) — цена проверки origin у `window.open`. Код перечитан по ветке
`worfy-browser/10` (`ab2469ee`).

## Что происходит

- После Ticket-а 10 обработчик `window.open` guest-страницы (`browserWindowOpenHandler`,
  `src/main/window.ts`) уводит страницу на адрес, только когда origin referrer-а совпадает с origin
  страницы. Иначе — `deny` и ничего.
- Поэтому ничего не открывают: ссылка `rel="noreferrer"` на самой странице, сайты с
  `Referrer-Policy: no-referrer`, `window.open` из iframe чужого origin. Пользователь не видит, что
  страница что-то просила.
- Electron 44 не блокирует popup без клика из `<webview allowpopups>` и не говорит обработчику, был ли
  клик и какой frame просит (e2e Ticket-а 10, `test/e2e/browser.spec.ts`).

## Что делаем

1. Когда обработчик отказал адресу http(s) по origin или пустому referrer, main сообщает renderer-у:
   Browser `id`, адрес.
2. В рамке этого Browser-а, под адресной строкой, — полоса: «The page wants to open `<url>`» и кнопки
   «Open» и закрыть. Текст — по-английски, как остальные надписи шапки Browser-а
   (`docs/design/BRIEF.md`). Адрес показывается целиком, длинный — с обрезкой посередине.
3. «Open» — страница уходит на адрес (тот же путь, что адресная строка). Клик — это и есть жест
   пользователя: без него ничего не открывается.
4. Новая просьба заменяет старую полосу; переход страницы или закрытие убирают полосу. Адреса не
   http(s) полосу не показывают — их по-прежнему не открывает ничто.

## Готово, когда

- [ ] Unit: обработчик при отказе по origin или пустому referrer сообщает адрес; при своём origin —
      не сообщает и уводит страницу, как в Ticket-е 10; адрес не http(s) — не сообщает.
- [ ] e2e `test/e2e/browser.spec.ts`: iframe чужого origin вызывает `window.open` без клика —
      страница на месте, видна полоса с адресом; «Open» — страница на адресе, полоса ушла; закрыть —
      страница на месте, полоса ушла. Ссылка `rel="noreferrer"` — то же.
- [ ] Снимок полосы в обеих темах.
- [ ] Мутанты красные: полоса не показывается; «Open» не уводит страницу; адрес не http(s)
      показывает полосу.
- [ ] `pnpm lint`, `pnpm typecheck` — exit 0 (полный `pnpm test` — gate full очереди).

## Где в коде

- `src/main/window.ts` (`browserWindowOpenHandler`)
- `src/renderer/canvas/nodes/BrowserNode.tsx`
- `src/renderer/canvas/nodes/BrowserNode.css`
- `src/renderer/canvas/overlays/BrowserLayer.tsx`
- `test/unit/window-options.test.ts`
- `test/e2e/browser.spec.ts`
- `test/fixtures/browser/`

Как main передаёт адрес renderer-у (событие guest-а, IPC окна) — выбор исполнителя; новый канал IPC —
в `src/shared/ipc/` по образцу соседних.

## Вне скоупа

- Browser profile — Ticket 03 (он трогает те же `BrowserNode.tsx` и `BrowserLayer.tsx` и идёт после
  этого Ticket-а).

## Итог

Заполняется при закрытии.
