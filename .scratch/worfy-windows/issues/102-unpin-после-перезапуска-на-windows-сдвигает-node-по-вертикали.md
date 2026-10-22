# 102 — Unpin после перезапуска на Windows сохраняет Node на Canvas на 7.6 px выше места на экране

Type: task
Status: open
Blocked by: —
Source: направление Session на Mac 2026-10-22, пересчёт красных e2e [Ticket-а 14](14-gate-full-на-windows.md);
замер на ПК 2026-10-22, main `d06d2c2d`, масштаб экрана 150 %.

## Что происходит

`test/e2e/pin-tags.spec.ts:179` («a pinned Node stays at its place on the screen while the Canvas pans and zooms,
after a restart too…») красный на Windows-ПК на проверке `:250`:

```
Error: expect(received).toBeCloseTo(expected, precision)
Expected: 204.75
Received: 197.14583333333337
Expected difference: < 0.5
Received difference:   7.604166666666629
```

После перезапуска закреплённый Node стоит на прежнем месте экрана (проверка `:236`, `expectSameBox`, проходит).
После Unpin прямоугольник, который приложение сохранило для Node-а на Canvas, нарисован на 7.6 px выше места,
где Node стоял на экране; по горизонтали (`:249`) и по ширине (`:251`) совпадает. Строка таблицы e2e Ticket-а 14
называла `pin-tags` среди вероятных падений группы 1 (размер окна по внешней рамке); после PR #708 этот test
по-прежнему красный, и причина группы 1 его, видимо, не объясняет.

Причина не разобрана: test или приложение (перевод места на экране в координаты Canvas при Unpin).

## Воспроизведение (ПК, 2026-10-22)

```
pnpm build && pnpm exec playwright test test/e2e/pin-tags.spec.ts --grep-invert @packaged
```

Красный в полном прогоне `pnpm test:e2e` и при повторе файла одного (2 из 2 — стойко); остальные 6 test-ов
файла зелёные.

## Что делаем

1. Найти, откуда 7.6 px: сравнить на ПК место Node-а до перезапуска, после перезапуска и после Unpin, а также
   положение `.react-flow` в окне. Проверить при масштабе экрана 100 %.
2. Если ошибка в переводе координат при Unpin — правка в приложении; если в test-е — в test-е. Причина — в «Итог».

## Готово, когда

- [ ] На ПК `pnpm build && pnpm exec playwright test test/e2e/pin-tags.spec.ts --grep-invert @packaged` — код 0.
- [ ] На Mac тот же spec — код 0.

## Где в коде

- `test/e2e/pin-tags.spec.ts`
- `src/renderer/canvas/pinning.ts`

## Итог

Разбор (только анализ, 2026-10-22, ПК, main `7feeac17`). Ошибка в test-е, не в переводе координат.

**Замер.** Временные замеры в spec-е (сняты до этого коммита), test-ы `-g "after a restart"`, 3 прогона
под замком e2e, все три — та же картина:

- Окно e2e: внешний размер 1280×800, содержимое 1264×735, `devicePixelRatio` = 1; `.react-flow` в окне
  (240, 52), 1024×683. Масштаб 150 % к ошибке не причастен: в окне test-а он 1, а x и ширина сходятся.
- До перезапуска и после него закреплённый Node сохранён в Layout-е как (210.33, 152.75), 183.33×100
  пикселей Canvas-а; на экране — (450.33, 204.75). Viewport после перезапуска тот же, что main сохранил
  перед выходом: x 170.565, y 103.942, zoom 0.5787 (и `viewport.get`, и transform `.react-flow__viewport`).
- Перевод при Unpin верен: стиль Node-а в React Flow до Unpin — `translate(68.72px, 84.34px)`, ровно
  `screenToCanvas` от (210.33, 152.75); `unpinOp` (`src/renderer/canvas/pinning.ts:126`) даёт тот же
  прямоугольник (68.72, 84.34), 316.8×172.8 единиц Canvas-а.
- Main сохраняет y = 71.2, то есть на 13.14 единицы (7.60 px при zoom 0.5787) выше. Это правило
  ADR-0038 (Node-ы не перекрываются): операция `pin` проходит через `settle()` → `freePlace()`
  (`src/main/layout/store.ts:254`, `src/shared/layout/free-place.ts:350`, зазор `NODE_GAP` = 16).
  Под Node-ом стоит Orchestrator Node, который main ставит на каждый Canvas: (120, 260), 360×200.
  Прямоугольник после Unpin (низ 84.34 + 172.8 = 257.14) попадает в зазор 16 над ним, и main
  поднимает Node до низа 260 − 16 = 244, то есть y = 244 − 172.8 = 71.2 — точно сохранённое значение.
- Проверка причины: Orchestrator Node, заранее записанный в Layout test-а далеко от заметок
  (120, 1400), — test зелёный (код 0, `1 passed`); правка была только в локальной копии, снята.

**Почему на Mac зелёный (не проверено).** Где Node окажется на Canvas-е после Unpin, зависит от высоты
Canvas-а: `⌘−` масштабирует вокруг его середины. На Windows полоса меню внутри окна, и содержимое ниже
(735 при внешних 800), чем на Mac; видимо, на Mac прямоугольник после Unpin не доходит до зазора
Orchestrator Node-а.

**Предлагаемая правка — в test-е.** `test/e2e/pin-tags.spec.ts:179` (вызов `writeLayout` в начале test-а)
и `writeLayout` (`:36`): записать в Layout этого test-а Orchestrator Node вдали от заметок, как делают
`test/e2e/epic-frame.spec.ts:561` и `test/e2e/wheel-over-nodes.spec.ts:45` — например
`{ id: 'orch', kind: 'orchestrator', x: 120, y: 1400, w: 360, h: 200, locked: true, data: {} }`. Тогда
место Node-а после Unpin не зависит от размера окна. Приложение не править: сдвиг Node-а с чужого места
при Unpin — принятое правило ADR-0038, а `unpinOp` переводит координаты верно. Число Node-ов на
миникарте (3) от правки не меняется.
