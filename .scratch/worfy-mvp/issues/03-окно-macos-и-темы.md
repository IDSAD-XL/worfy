# 03 — Окно macOS с sidebar и toolbar, светлая и тёмная тема по системной настройке

Type: task
Status: blocked — ревью дважды не чистое: flaky e2e test test/e2e/window.spec.ts:78 — после SIGKILL нет ожидания выхода процесса, rm dataDir без повторов; PR #4
Blocked by: 01
Source: [F-SPEC.md](../../../docs/design/F-SPEC.md), разделы «Typography», «Shape», «Tokens»; макеты `docs/design/F-canvas-light.dc.html`, `F-canvas-dark.dc.html`; [BRIEF.md](../../../docs/design/BRIEF.md)

## Что делаем

Оболочка окна по выбранному дизайну F: нативная рамка macOS и плотная «графитовая» типографика
данных.

- Окно: `titleBarStyle: 'hiddenInset'`, светофор слева, unified toolbar, sidebar с эффектом
  полупрозрачности (`vibrancy: 'sidebar'`). Размер и положение окна запоминаются.
- Токены цвета из F-SPEC — CSS-переменные в `src/renderer/theme/tokens.css`. Светлые значения
  (палитра E) и тёмные (палитра Graphite) переключаются через
  `@media (prefers-color-scheme: dark)`; Electron передаёт системную настройку сам. Своего
  переключателя темы нет.
- Шрифты: системный UI-шрифт и `ui-monospace` с `tabular-nums` для всех id, путей, чисел,
  веток, моделей. Размеры 11/12/13/15/20, радиусы и сетка 4/8 px — из F-SPEC. В тёмной теме
  теней нет, только рамки 1 px.
- `AppShell.tsx`: sidebar + toolbar + основная область. Toolbar: имя Проекта и ветка (пока
  заглушки), сегментный переключатель Canvas / Session, подсказка «⌘K».
- Точки расширения: `Sidebar.tsx` собирает разделы из `src/renderer/shell/sidebar/*Section.tsx`,
  `Toolbar.tsx` — элементы из `src/renderer/shell/toolbar/*.tsx` (через `import.meta.glob`, с
  явным порядком в экспорте каждого модуля).
- Компоненты-примитивы, которые нужны всем следующим тикетам: строка списка 28 px, chip статуса
  (прямоугольник, радиус 4 px, цвет всегда с текстом или иконкой), кнопка основного действия,
  сегментный переключатель. Цвета статусов — ready, working, blocked, done — из таблицы токенов.

## Готово, когда

- [ ] Окно открывается с нативным светофором и toolbar, без системной полосы заголовка.
- [ ] Переключение системной темы меняет оформление без перезапуска.
- [ ] Цвета фона, поверхности Узла, текста и статусов в обеих темах совпадают с F-SPEC (test сверяет вычисленные CSS-переменные со значениями из таблицы).
- [ ] Контраст текста к фону ≥ 4.5:1 для text, secondary и muted в обеих темах.
- [ ] Новый раздел sidebar появляется от одного нового файла `*Section.tsx` без правки `Sidebar.tsx`.
- [ ] Положение и размер окна переживают перезапуск.

## Тесты

- `test/e2e/theme.spec.ts` — Playwright `emulateMedia({colorScheme})` для light и dark: значения CSS-переменных и наличие/отсутствие тени Узла (новый).
- `test/unit/contrast.test.ts` — расчёт контраста пар токенов (новый).
- Сначала падающий test: `theme.spec.ts` проверяет `--surface` = `#1B1A18` в dark до появления токенов.

## Где в коде

- `src/main/window.ts`
- `src/renderer/theme/tokens.css`, `src/renderer/theme/primitives.tsx`
- `src/renderer/shell/AppShell.tsx`, `src/renderer/shell/Sidebar.tsx`, `src/renderer/shell/Toolbar.tsx`
- `test/e2e/theme.spec.ts`
