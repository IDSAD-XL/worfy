# 09 — Ссылки на Guide из Getting started и First run

Type: task
Status: open
Blocked by: 03
Source: [spec.md](../spec.md), Q4

## Что происходит

Новый пользователь должен увидеть Guide без поиска в меню. Панель Getting started переделывает `worfy-onboarding` 13, поэтому Ticket не раздаётся раньше него.

## Что делаем

Ссылка «worfy Guide» в панели Getting started и на странице понятий First run (`src/renderer/shell/FirstRunConcepts.tsx`). Guide сам не открывается.

## Готово, когда

- [ ] Ссылка в обоих местах открывает Guide.
- [ ] Существующему пользователю ничего не открывается само.

## Тесты

- e2e: `test/e2e/guide.spec.ts` (extend).

## Где в коде

- Панель Getting started после `worfy-onboarding` 13, `src/renderer/shell/FirstRunConcepts.tsx`.

## Итог
