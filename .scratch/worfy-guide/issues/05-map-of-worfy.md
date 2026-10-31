# 05 — Map of worfy: обзорная схема, из которой можно перейти в любой Topic

Type: task
Status: open
Blocked by: 04
Source: [spec.md](../spec.md), Q7, Q13, Q18

## Что происходит

Новому пользователю нужна одна картинка: как связаны Project, Canvas, Session, Epic, Ticket, Wave, Autopilot, Gate и Harness. Основа — `docs/features/concepts.md`.

## Что делаем

Map of worfy в выбранном стиле первым пунктом списка: простой уровень, Under the hood, оба языка. Блок ведёт в свой Topic; блок ещё не написанного Topic-а ведёт на Full page.

## Готово, когда

- [ ] Связи и подписи сверены с кодом и `docs/features/concepts.md`.
- [ ] Клик по блоку открывает Topic или страницу.
- [ ] Обе темы, оба языка, reduced motion проверены снимками.

## Тесты

- Тесты реестра из Ticket-а 03 покрывают новый Topic; e2e переход по клику в `test/e2e/guide.spec.ts`.

## Где в коде

- `src/renderer/guide/`, `docs/features/concepts.md`, `CONTEXT.md` — только чтение.

## Итог
