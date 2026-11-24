# 33: Rework of worfy-product-session 21, item 7

Type: task
Status: open
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
