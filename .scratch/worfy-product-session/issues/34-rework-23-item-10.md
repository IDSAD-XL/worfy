# 34: Rework of worfy-product-session 23, item 10

Type: task
Status: open
Blocked by: None — can start immediately
Source: owner-check fail 2026-11-24 of worfy-product-session 23, item 10 — 23-mind-map-размер-текст-и-карточка-узла-как-в-прототипе.md

**What to build:** the owner checked item 10 of worfy-product-session 23 on mac dev and it failed. In the words of the owner:

> Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); the Orchestrator saw on a dev build of 2e96e91ac: Very long node: 4 lines + «…», inside, title = full text. But short nodes «Отдельный экран продуктовой работы…» and «Файл в docs/product/ правит tool…» are cut with «…» too (both have fold marks).

## Что происходит

Обрезка «…» срабатывает не только у очень длинного узла: короткие узлы «Отдельный экран продуктовой работы…» и «Файл в docs/product/ правит tool…» тоже обрезаны и несут метку свёртки, хотя текст помещается в четыре строки.

## Где в коде

Обрезка текста узла Mind map до четырёх строк: `src/renderer/product/` (узел карты и его CSS). Fixture `LONG_MAP`.

## Готово, когда

- [ ] (manual) Сделай: найди узел «Очень длинный текст узла…» и наведи на него → Должно быть: в узле 4 строки и «…», ни одна буква не выходит за контур; tooltip — полный текст. У других узлов текст целиком, без обрезки.
  - needs: mac stable
