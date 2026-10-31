# 20 — Закрытие Epic-а: отчёт об отставании в ежемесячном аудите

Type: task
Status: open
Blocked by: 11, 12, 13, 14, 15, 16, 17, 18, 19
Source: [spec.md](../spec.md), Q9, Q17

## Что происходит

Запланированная задача `worfy-feature-docs-monthly-audit` на Mac не знает про Topic-и.

## Что делаем

1. Добавить `node scripts/guide-lag.mjs` в текст запланированной задачи, отчёт о Topic-ах рядом с отчётом о страницах.
2. Обновить отставшие Topic-и и переводы по отчёту.
3. Закрыть «Готово, когда» spec-а, строку Epic-а в `HANDOFF.md`, `node scripts/check-handoff.mjs`.

## Готово, когда

- [ ] `scripts/guide-lag.mjs`: нет отстающих, exit code 0.
- [ ] Задача обновлена и видна в списке запланированных задач.
- [ ] Все пункты spec-а отмечены.

## Тесты

Нет.

## Где в коде

- `scripts/guide-lag.mjs`, `HANDOFF.md`.

## Итог
