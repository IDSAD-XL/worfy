# 34: Rework of worfy-product-session 23, item 10

Type: task
Status: done 2026-11-25T03:02Z
PR: #2188
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
  - evidence: screenshot pass · `../evidence/33-34-tree-light.png` · mac dev · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8 · scrub: 2026-11-25
  - evidence: screenshot pass · `../evidence/33-34-tree-dark.png` · mac dev · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8 · scrub: 2026-11-25
- [ ] Unit test (`test/unit/mind-map-node-width.test.ts`): на карте LONG_MAP ни в Tree, ни в Graph не обрезан ни один узел, кроме «Очень длинный текст узла…»; узел-ветка «Отдельный экран продуктовой работы…» шире обычного и вмещает все строки; узел с текстом, которому не хватает и самого широкого узла, обычной ширины и в четыре строки. На коде origin/main test красный.
  - evidence: test-run pass · `pnpm test test/unit/mind-map-node-width.test.ts` exit 0 · mac - · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8
  - evidence: review pass · PR #2188 · - - · 1e2e97d64f66a9f615f465d8a5f2c2e796afe8f1
- [ ] e2e test (`test/e2e/product-session.spec.ts`, карта LONG_MAP): в окне «…» только у `very-long`, в Tree и в Graph, и ни одна строка не выходит за контур узла.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/product-session.spec.ts` exit 0 · mac dev · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8
  - evidence: review pass · PR #2188 · - - · 1e2e97d64f66a9f615f465d8a5f2c2e796afe8f1
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/45531742195/job/138943464559 · ci - · 1e2e97d64f66a9f615f465d8a5f2c2e796afe8f1
