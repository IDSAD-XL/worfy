# 26 — Toolbar: подписи Limits, длинное имя Project-а, статус окна

Type: task
Status: open
Blocked by: 06, 07, 08, 09
Source: [spec.md](../spec.md), тема C; ручная проверка 2026-10-06, ночь — Ticket 22 worfy-mvp (`.scratch/worfy-mvp/issues/22-лимиты.md:183`); Ticket 11 этого Epic-а, «Что известно»; HANDOFF, «Риски и долги»

## Что делаем

Toolbar — строка вверху окна: имя Project-а, переключатель Canvas/Session, полосы Limits и поиск.

**1. Подпись «as of» в toolbar нечитаема.** Когда данным Limits больше часа, под полосой появляется
«resets 06:20 · as of 04:53». У полосы в toolbar ширина 104 px и `whiteSpace: 'nowrap'`
(`src/renderer/limits/LimitBar.tsx:58` и `:67`). Подпись 5-hour налезает на 7-day, а та уходит под
«v0.0.0» и поле поиска. При смене дня подпись ещё длиннее: «as of Mon HH:MM». В rail текст
переносится и читается.

Правка — по F-SPEC: подпись в toolbar помещается в ширину полосы — короче, в две строки или только
в tooltip. Полный текст есть в `title`. Rail не меняется.

**2. Длинное имя Project-а** в toolbar не обрезается и выталкивает за край окна переключатель
Canvas/Session, Limits и поиск (`src/renderer/shell/Toolbar.tsx:68`; в
`src/renderer/shell/shell.css:86-91` у имени `white-space: nowrap` без обрезки). Правка: имя
обрезается с многоточием, полное — в `title`. Остальные элементы toolbar всегда видны.

**3. Статус окна 7-day пропадает после записи моста.** Мост status line — скрипт, который пишет
Limits из status line Claude Code в файл worfy. Статуса окна в нём нет, и его запись ставит
`status: null` (`src/shared/agent/limits.ts:111`). Статус `allowed_warning` от SDK пропадает, и
полоса теряет цвет предупреждения: из синей (уровень `working`, `limits.ts:187-189`) становится
серой. Правка: запись без статуса не сбрасывает статус от SDK, пока окно то же — время сброса не
сменилось. Как сравнивать время сброса из двух источников, решает Ticket; ответ — в «Итог».

## Готово, когда

- [ ] Данные Limits старше часа: подписи 5-hour и 7-day в toolbar не пересекаются друг с другом, с «v0.0.0» и с полем поиска. e2e сравнивает boundingBox; полный текст — в `title`.
- [ ] Имя Project-а из 80 символов при ширине окна 1280 px: переключатель Canvas/Session, Limits и поиск внутри окна, имя с многоточием, полное — в `title`. e2e сравнивает boundingBox с шириной окна.
- [ ] Запись моста без статуса после `allowed_warning` от SDK для того же окна оставляет `allowed_warning`; новое окно (другой `resetsAt`) статус сбрасывает. Unit-test.
- [ ] Снимки toolbar в светлой и тёмной теме сверены с F-SPEC.

## Тесты

- `test/e2e/limits.spec.ts` — подписи «as of» в toolbar.
- `test/e2e/toolbar.spec.ts` (новый) — длинное имя Project-а.
- `test/unit/limits.test.ts` — статус окна после записи моста.
- Сначала падающий test: e2e находит пересечение boundingBox подписей 5-hour и 7-day.

## Где в коде

- `src/renderer/limits/LimitBar.tsx`
- `src/renderer/shell/Toolbar.tsx`
- `src/renderer/shell/shell.css`
- `src/shared/agent/limits.ts`
- `test/unit/limits.test.ts`
- `test/e2e/limits.spec.ts`
- `test/e2e/toolbar.spec.ts` (новый)
