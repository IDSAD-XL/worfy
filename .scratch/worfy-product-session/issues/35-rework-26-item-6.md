# 35: Rework of worfy-product-session 26, item 6

Type: task
Status: open
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
