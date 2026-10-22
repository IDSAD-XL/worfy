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
