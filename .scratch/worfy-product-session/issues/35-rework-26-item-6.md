# 35: Rework of worfy-product-session 26, item 6

Type: task
Status: claimed 2026-11-24T23:33Z
Blocked by: None — can start immediately
Source: owner-check fail 2026-11-24 of worfy-product-session 26, item 6 — 26-граф-радиальный-как-в-прототипе.md

**What to build:** the owner checked item 6 of worfy-product-session 26 on mac dev and it failed. In the words of the owner:

> Delegated by the owner 2026-11-24 («Проведи приемку всего что можешь сам»); the Orchestrator saw on a dev build of 2e96e91ac: Graph: no overlaps, straight grew-from lines, red dashed curved Replaces, text 12 px vs 15 px. But topic is not central: at 26 % from top of the node cluster, 7 of 11 nodes below it.

## Что происходит

В виде Graph тема стоит не в центре: на 26 % от верха группы узлов, 7 из 11 узлов ниже неё. Пересечений нет, рёбра и размер текста верные.

## Где в коде

Раскладка Graph Mind map (radial, решение владельца 2026-11-09): `src/renderer/product/`.

## Готово, когда

- [ ] (вручную) Сделай: переключи «Tree · Graph» на «Graph» и сравни с «граф» прототипа → Должно быть: тема в центре, ветки расходятся в разные стороны, узлы не накрывают друг друга; стрелки «выросло из» прямые; «Replaces» — красная пунктирная кривая; текст мельче, чем в «Tree».
  - needs: mac stable
  - evidence: screenshot pass · `../evidence/35-graph-light.png` · mac dev · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8 · scrub: 2026-11-25
  - evidence: screenshot pass · `../evidence/35-graph-dark.png` · mac dev · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8 · scrub: 2026-11-25
- [ ] Unit test (`test/unit/mind-map-graph-centre.test.ts`): в Graph карты LONG_MAP (и с Hide rejected) центр темы в пределах 0,4–0,6 рамки всех узлов по обеим осям, с каждой стороны темы не меньше трети узлов; ни одна стрелка «grew from» не идёт поверх узла (LONG_MAP, Hide rejected, карта с пятью ветками); красная кривая «Replaces» не идёт поверх темы и накрывает не больше узлов, чем изгиб прототипа; одна ветка остаётся цепочкой без пересечений. На коде origin/main test красный.
  - evidence: test-run pass · `pnpm test test/unit/mind-map-graph-centre.test.ts` exit 0 · mac - · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8
- [ ] Unit test (`test/unit/mind-map-layout.test.ts`): прежние свойства радиальной раскладки держатся — без наложений, детерминированно, 150 узлов во всех четырёх четвертях, глубже — дальше от темы, цепочка в 4000 узлов раскладывается сразу.
  - evidence: test-run pass · `pnpm test test/unit/mind-map-layout.test.ts` exit 0 · mac - · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8
- [ ] e2e test (`test/e2e/product-session.spec.ts`, карта LONG_MAP): в Graph центр темы в пределах 0,4–0,6 по обеим осям, кривая «Replaces» не заходит в тему; снимки Graph в светлой и тёмной теме.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/product-session.spec.ts` exit 0 · mac dev · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · ba1ccadc0f1072cd6eb502f4e1bb0e3a694e5ab8
