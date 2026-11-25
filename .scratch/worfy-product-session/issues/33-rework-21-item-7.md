# 33: Rework of worfy-product-session 21, item 7

Type: task
Status: claimed 2026-11-24T23:33Z
Blocked by: None — can start immediately
Source: owner-check fail 2026-11-24 of worfy-product-session 21, item 7 — 21-mind-map-выглядит-как-в-прототипе.md

**What to build:** the owner checked item 7 of worfy-product-session 21 on mac dev and it failed. In the words of the owner:

> Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); the Orchestrator saw on a dev build of 2e96e91ac: Grew-from: grey curves with grey arrowheads, fine. Replaces in Tree: the split node sits right under the rejected Decision, so it is an 11 px path: just a tiny red arrowhead, no visible dashed line.

## Что происходит

В виде Tree связь «Replaces» между отклонённым и принятым Решением рисуется путём длиной около 11 px: принятое Решение стоит прямо под отклонённым, и видна только маленькая красная стрелка, пунктирной линии нет.

## Где в коде

Раскладка Tree и рисование рёбер Mind map: `src/renderer/product/` (раскладка дерева и слой рёбер). Fixture — `test/fixtures/product-topic`.

## Готово, когда

- [ ] (manual) Сделай: посмотри на связи → Должно быть: «выросло из» — кривая с серой стрелкой у ребёнка; «Replaces» — красный пунктир с красной стрелкой от «Mind map 60 / чат 40…» к отклонённому Решению, как в прототипе.
  - needs: mac stable
  - evidence: screenshot pass · `../evidence/33-34-tree-light.png` · mac dev · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8 · scrub: 2026-11-25
  - evidence: screenshot pass · `../evidence/33-34-tree-dark.png` · mac dev · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8 · scrub: 2026-11-25
- [ ] Unit test (`test/unit/mind-map-tree-replaces.test.ts`): в Tree ELK ставит «Mind map 60 / чат 40…» прямо под отклонённое Решение; стрелка «Replaces» огибает их колонку справа, длиннее 60 px, не заходит ни в один из двух узлов и входит в правый край отклонённого Решения остриём влево; при любом порядке двух узлов; между узлами разных колонок — кривая прототипа. На коде origin/main test красный.
  - evidence: test-run pass · `pnpm test test/unit/mind-map-tree-replaces.test.ts` exit 0 · mac - · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8
- [ ] Unit test (`test/unit/mind-map-view.test.tsx`, «draws `replaces` as its own red dashed arrow…»): в окне ребро `replaces` в Tree начинается у правого края позднего Решения, кончается в 0–8 px правее отклонённого и выходит за колонку больше чем на 20 px.
  - evidence: test-run pass · `pnpm test test/unit/mind-map-view.test.tsx` exit 0 · mac - · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8
- [ ] e2e test (`test/e2e/product-session.spec.ts`, карта LONG_MAP): путь «Replaces» в Tree пунктирный и длиннее 60 px; снимки Tree в светлой и тёмной теме.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/product-session.spec.ts` exit 0 · mac dev · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8
