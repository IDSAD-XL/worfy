# 15 — Pilot на roadmap worfy

Type: task
Status: open
Blocked by: 09, 13, 14
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 12; «Готово, когда»; карта [worfy-product](../../worfy-product/map.md), решение 03 (Q4), «Not yet specified» (план pilot на roadmap worfy); раздел roadmap [«worfy для соло-разработки продукта»](../../../docs/roadmap.md#worfy-для-соло-разработки-продукта)

Не платформенный Ticket: работа с владельцем на Mac Stable, без кода. Глубина ревью — `low` (только docs PR с
файлами `docs/product/`).

## Что происходит

- После 01–14 на Stable copy есть Product Session, Mind map, критик, идеи и доля принятых.
- Следующая работа направления по roadmap — второй Epic, обзор рынка с поиском в сети; его spec ещё не написан.

## Что делаем

1. Stable copy владельца обновлена на `main` с 01–14; версия — в «Итог».
2. Владелец открывает «New Product Session» на Project-е worfy; тема `roadmap-worfy`: разговор о разделе roadmap
   «worfy для соло-разработки продукта» и о втором Epic-е.
3. Хотя бы один раунд идей (`worfy:product-ideas`) и хотя бы один черновик Epic-а в `drafts/` с пометкой «черновик
   советника».
4. Orchestrator перед приёмкой этого или любого другого spec-а зовёт критика (правило 13); разбор — в
   `docs/product/critic/`.
5. Владелец отмечает каждый совет; доля принятых в шапке — в «Итог».
6. Что мешало — Ticket-ы `worfy-polish` (low findings не становятся Ticket-ами); что работает не так, как решено
   картой, — вопрос владельцу.
7. Файлы `docs/product/` — docs PR Orchestrator-а (Q5 spec-а).

## Готово, когда

- [ ] (manual) Product Session на Project-е worfy: тема `roadmap-worfy`, Mind map растёт по ходу разговора без
      перезагрузки — снимок экрана с проверкой пикселей.
  - needs: mac stable
- [ ] (manual) Хотя бы один раунд идей: 3–5 идей с четырьмя полями, одна против roadmap — узлы в Mind map.
  - needs: mac stable
- [ ] (manual) Хотя бы один разбор критика перед приёмкой spec-а; spec ссылается на него строкой `Критик:`.
  - needs: mac stable
- [ ] Доля принятых советов на конец pilot-а записана в «Итог» (N из M).
- [ ] (manual) Владелец говорит, полезен ли советник, — его слова в «Итог».
  - needs: mac stable
- [ ] Docs PR с `docs/product/roadmap-worfy/` и `docs/product/critic/` влит.

## Тесты

- Без новых test-ов: pilot проверяет готовое. Снимки — `.scratch/worfy-product-session/evidence/15-*`, с проверкой
  пикселей (`scrub:`).

## Где в коде

- `.scratch/worfy-product-session/evidence/15-*`
- `docs/product/roadmap-worfy/**`
- `docs/product/critic/**`

Только читать: `docs/roadmap.md`, `.scratch/worfy-product/map.md`.
