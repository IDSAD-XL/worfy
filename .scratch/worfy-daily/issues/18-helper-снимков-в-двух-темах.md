# 18 — Helper снимков в двух темах

Type: task
Status: open
Blocked by: 17
Source: [spec.md](../spec.md), тема F; [F-SPEC.md](../../../docs/design/F-SPEC.md)

## Что делаем

Нестабильные e2e раньше были частью этого Ticket-а. Решением владельца 2026-10-06 они вынесены в
Ticket 21, который идёт в Wave 1. Здесь остался только helper снимков.

**Helper снимков** (тема F): `test/e2e/snapshots.ts`.

- Один вызов снимает окно `page.screenshot()` в светлой и тёмной теме через
  `window.emulateMedia({ colorScheme })` — так уже делают `canvas-layout.spec.ts:161` и
  `session-controls.spec.ts:115`.
- Снимки кладутся в `test-results/snapshots/<имя>/`.
- Ревьюер UI-Ticket-а сверяет их с F-SPEC. Само правило ревью вносит в skill workflow
  проектирования, не этот Ticket.

## Готово, когда

- [ ] Один вызов helper-а снимков даёт два PNG — light и dark. e2e проверяет, что оба файла есть и различаются.

## Тесты

- `test/e2e/snapshots.spec.ts` (новый) — helper снимков.
- Сначала падающий test: `snapshots.spec.ts` ждёт два различающихся PNG и падает, пока helper-а нет.

## Где в коде

- `test/e2e/snapshots.ts` (новый)
- `test/e2e/snapshots.spec.ts` (новый)
