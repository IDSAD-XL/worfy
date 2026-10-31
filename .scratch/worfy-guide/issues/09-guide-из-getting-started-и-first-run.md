# 09 — Ссылки на Guide из Getting started и First run

Type: task
Status: claimed 2026-10-31T16:34Z
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

Ссылка «worfy Guide» стоит внизу панели Getting started, слева от «Skip» (и под шагами, и на экране Done), и под тремя понятиями страницы «Welcome to worfy» First run: «Short visual help: worfy Guide. It is in the Help menu too.» Обе вызывают тот же `openGuide()` из `src/renderer/guide/store.ts`, что меню и Command palette (Ticket 03); второго пути через IPC нет. Guide открывается поверх: First run остаётся на своей странице, панель — как была; Esc закрывает только Guide, фокус возвращается на ссылку.

Сам Guide не открывается ни новому, ни существующему пользователю: новому First run открывается на понятиях и панель показывается, Guide — нет; существующему First run идёт сразу к проверкам, в углу notice, ни Guide, ни панели, ни pill-а. Это закрепляет e2e `test/e2e/guide-entry-links.spec.ts`.

Цвет ссылок — `--accent` на `--surface`; e2e читает цвета в обеих темах и требует контраст не меньше 4.5:1 (светлая тема — около 5.8:1). Панель Getting started не переведена (переведён только сам Guide), поэтому текст ссылок только английский.

Отступление от раздела «Тесты»: e2e-проверки лежат в новом файле `test/e2e/guide-entry-links.spec.ts`, а не в `test/e2e/guide.spec.ts` — решение Orchestrator-а: `guide.spec.ts` расширяют PR #1149 (Ticket 04) и Ticket 05. Новый spec открывает First run сам (`WORFY_FIRST_RUN_AUTO=1`), поэтому он добавлен в правило проверок First run в `scripts/e2e-specs.table.json` и в его contract test.

Снимки: [First run, светлая](../evidence/09-first-run-light.png), [First run, тёмная](../evidence/09-first-run-dark.png), [панель, светлая](../evidence/09-panel-light.png), [панель, тёмная](../evidence/09-panel-dark.png).
