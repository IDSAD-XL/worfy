# 94 — Чип состояния «open» на карточке Ticket-а на Windows выше своей рамки на 1 px

Type: task
Status: open
Blocked by: —
Source: [Ticket 14](14-gate-full-на-windows.md), e2e группы 4 (stub `epic-status` делит путь по `/`); замер на ПК
2026-10-22, ветка `worfy-windows/14-paths` поверх main `8f5238c8`, масштаб экрана 150 %.

## Что происходит

e2e `test/e2e/epic-frame.spec.ts:832` («long names: …») на Windows-ПК красный. Раньше он падал раньше —
stub `epic-status` не находил Epic, потому что делил путь по `/` (группа 4 Ticket-а 14). После починки stub-а
test доходит до проверки «на карточке ничего не обрезано» (`ticketCardCuts`, `test/e2e/helpers.ts:742`) и
падает на ней в трёх прогонах из четырёх (в четвёртом зелёный, без изменений в коде — значит, высота строки
зависит от чего-то в прогоне, от чего — не выяснено):

```
Error: nothing is cut on Ticket 40
+   "<span class=\"w-chip w-chip--open\"> «open»: 17 px tall in 16 px",
```

У чипа `.w-chip` (`src/renderer/theme/primitives.css:4`) высота 18 px, `box-sizing: border-box`, у
`.w-chip--open` рамка 1 px (`src/renderer/canvas/epic-frame.css:378`): внутри остаётся 16 px. Высота строки
не задана (`line-height: normal`), шрифт — `--font-ui` (`src/renderer/theme/tokens.css:13`), где все
шрифты из macOS; на Windows Chromium берёт запасной `sans-serif`. Строка текста этого шрифта при 12 px
выходит 17 px (`scrollHeight`) в 16 px (`clientHeight`). На macOS test зелёный.

Не измерено: какой шрифт Chromium подставляет на ПК, видна ли обрезка глазом (`overflow` у чипа
`visible`, так что глиф, скорее всего, не режется, а только выходит на рамку), повторяется ли это при
масштабе 100 %, есть ли те же 17 в 16 px у других чипов `.w-chip` вне этого test-а.

## Что делаем

Решить, где причина: в приложении (у чипа нет своей высоты строки, и на шрифте Windows текст выше
коробки) или в проверке (`scrollHeight` целый и при 150 % округляется вверх). По решению — одно из:
- задать чипу высоту строки, которая помещается в 16 px на всех системах, и проверить, что на macOS
  карточка не изменилась (снимки `epic-frame` обеих тем);
- или в `ticketCardCuts` сравнивать высоту по нарисованным коробкам с допуском, как она уже делает для
  выхода за предка (`EPSILON`), и записать, почему целый `scrollHeight` не годится.

## Готово, когда

- [ ] На ПК `pnpm build && pnpm exec playwright test test/e2e/epic-frame.spec.ts --grep-invert @packaged --repeat-each=5` — код 0.
- [ ] На Mac тот же spec — код 0; снимки карточек `epic-frame` не изменились, если менялся CSS.

## Где в коде

- `src/renderer/theme/primitives.css`
- `src/renderer/canvas/epic-frame.css`
- `test/e2e/helpers.ts`
- `test/e2e/epic-frame.spec.ts`

## Итог
