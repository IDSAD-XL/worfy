# 17 — Pilot на проекте auction

Type: task
Status: open
Blocked by: 15
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 12; «Соглашения для Ticket-ов этого Epic-а» (содержимое auction в репозиторий worfy не попадает); карта [worfy-product](../../worfy-product/map.md), решение 03 (Q4)

Не платформенный Ticket: работа с владельцем на Mac Stable, без кода worfy. Глубина ревью — `low`.

## Что происходит

- Pilot на roadmap worfy (15) прошёл; его итог — доля принятых и слова владельца.
- auction — второй Project владельца со своим Profile-ем; его документы и решения в публичный репозиторий worfy не
  попадают.

## Что делаем

1. Владелец открывает «New Product Session» на Project-е auction; тему выбирает он.
2. Хотя бы один раунд идей и один разбор критика перед приёмкой spec-а Epic-а auction.
3. Файлы `docs/product/` остаются в репозитории auction (или в его Workflow folder в Silent mode — Q6 spec-а).
4. В этот Ticket пишутся только числа и выводы без содержания: число советов, доля принятых, что в Product Session
   мешало на чужом проекте. Ни названий функций auction, ни цитат.
5. Что мешало — Ticket-ы `worfy-polish`.

## Готово, когда

- [ ] (manual) Product Session на auction: хотя бы один раунд идей и один разбор критика; снимок не публикуется.
  - needs: mac stable
- [ ] Доля принятых советов на auction — N из M в «Итог», без содержания проекта.
- [ ] (manual) Владелец говорит, полезен ли советник на auction, — его слова в «Итог» без подробностей проекта.
  - needs: mac stable

## Тесты

- Без новых test-ов.

## Где в коде

- `.scratch/worfy-product-session/evidence/17-*`

Только читать: Profile auction (через `bin/profile`, вне репозитория worfy).
