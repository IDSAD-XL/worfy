# 12 — Полоса «Open»: домен адреса виден целиком; test сверки запроса со своим Browser-ом

Type: task
Status: claimed 2026-10-20T18:55Z
Blocked by: 11
Source: review PR #614 (Ticket 11), две находки low, 2026-10-20. Код перечитан по ветке
`worfy-browser/11` (`5e08df41`).

## Что происходит

- Полоса «The page wants to open `<url>`» (Ticket 11) режет длинный адрес посередине
  (`src/renderer/canvas/nodes/BrowserNode.tsx:159`, `BrowserNode.css:140`). При такой обрезке может
  пропасть именно домен. Пример: iframe чужого origin вызывает `window.open` на
  `https://bank.example.com.aaaa…aaaa.evil.net/…/bank.example.com/login`. В полосе видно
  `https://bank.example.com.a…` и конец пути, а настоящий домен `evil.net` есть только в tooltip.
  Пользователь нажимает «Open», думая, что это банк.
- Слой Browser-ов сверяет событие из main со своим `<webview>`: `webContentsId === own`
  (`src/renderer/canvas/overlays/BrowserLayer.tsx:134`). Эту сверку не проверяет ни один test: все
  e2e работают с одним Browser-ом. Если заменить условие на `true`, test-ы останутся зелёными. Тогда
  при двух Browser-ах полоса встанет на обоих, и «Open» уведёт чужую страницу.

## Что делаем

1. Полоса показывает host адреса (`new URL(url).host`) целиком всегда. Обрезается только остальное:
   путь, query, fragment — посередине, как сейчас. Схему можно не показывать, если её нет в
   соседних надписях шапки. Полный адрес — по-прежнему в tooltip.
2. Unit-test на сверку: два Browser-а с разными web contents id. Событие для одного ставит полосу
   только ему. Если удобнее вынести сверку в чистую функцию рядом с `browser-frame.ts`, вынести.

## Готово, когда

- [ ] Длинный адрес с длинным host-ом: host виден целиком, обрезан путь (unit-test на функцию
      форматирования адреса или e2e на текст полосы).
- [ ] Unit-test: событие с id второго Browser-а не ставит полосу первому; мутант «условие всегда
      true» даёт exit 1.
- [ ] Снимок полосы с длинным адресом в обеих темах (`snapshotThemes`).

## Где в коде

- `src/renderer/canvas/nodes/BrowserNode.tsx`
- `src/renderer/canvas/nodes/BrowserNode.css`
- `src/renderer/canvas/overlays/BrowserLayer.tsx`
- `src/renderer/canvas/nodes/browser-frame.ts`
- `test/unit/` — новый test на форматирование адреса и сверку
- `test/e2e/browser.spec.ts` — если проверка текста полосы идёт через e2e

## Вне скоупа

- Поведение main (`browserWindowOpenHandler`) не меняется.

## Итог
