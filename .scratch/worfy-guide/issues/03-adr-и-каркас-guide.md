# 03 — ADR и каркас Guide: окно, реестр Topic-ов, EN/RU, входы из меню и Command palette

Type: task
Status: open
Blocked by: 02
Source: [spec.md](../spec.md), Q1, Q3, Q4, Q5, Q9, Q16, Q17, Q20, Q21

## Что происходит

Help menu держит один пункт, Keyboard Shortcuts (`src/main/menu.ts:95-104`). Окно приложения одно (`src/main/window.ts:124`), поверх него открываются окна внутри страницы: Keyboard Shortcuts (`src/renderer/shell/AppShell.tsx:111`) и Settings (`AppShell.tsx:109`). Слоя i18n нет. Компонент Markdown не показывает картинки и SVG (`src/renderer/markdown/Markdown.tsx:15-16`), поэтому Guide его для схем не использует. CSP позволяет inline SVG (`src/renderer/index.html:5`).

Не раздавать, пока не влиты `worfy-onboarding` 13 и 14 (Q12).

## Что делаем

1. ADR: Guide — первое исключение из правила «UI только на английском», без общего i18n; содержимое в коде; цвета `kind-*` на схемах и крупная типографика как исключение из `docs/design/F-SPEC.md:46` (Q14).
2. Окно поверх интерфейса: список Topic-ов слева, Topic справа, Esc закрывает. Работает без Project и без сети. Отдельный чанк (`React.lazy`), запуск приложения не замедляется.
3. Реестр Topic-ов в `src/renderer/guide/`: заголовок, страницы-источники с SHA, тексты простого уровня и Under the hood на двух языках, таблица файлов.
4. Переключатель EN / RU в шапке: по умолчанию русский, если система на русском, иначе английский; выбор запоминается.
5. Входы: Help ▸ worfy Guide, строка в Command palette и строка на каждый Topic. Сам Guide не открывается никогда.
6. Ссылки: Full page и файлы Under the hood ведут на GitHub, на commit этой сборки; если он неизвестен, на `main`. Ссылки открываются во внешнем браузере.
7. Отчёт об отставании `scripts/guide-lag.mjs`: Topic, чья страница-источник ушла вперёд его SHA, и русский текст старше английского. В `pnpm lint` не входит, как `scripts/feature-docs-lag.mjs`.
8. Один тестовый Topic для проверки каркаса; реальные Topic-и — следующие Ticket-ы. В релизной сборке тестовый Topic не показывать.

## Готово, когда

- [ ] ADR принят.
- [ ] Guide открывается из Help menu и Command palette, без Project и без сети, закрывается по Esc; сам не открывается.
- [ ] Переключатель языка работает и запоминается; строка без одной из двух версий падает на test-е.
- [ ] Чанк Guide не загружается при старте приложения.
- [ ] Ссылки на GitHub несут commit сборки, при неизвестном commit ведут на `main`.
- [ ] `scripts/guide-lag.mjs` находит отставшую страницу и отставший перевод.
- [ ] Снимки в обеих темах и на двух языках в `.scratch/worfy-guide/evidence/`.

## Тесты

- Unit: полнота перевода; существование страниц-источников; существование файлов из таблиц на commit репозитория; выбор языка по умолчанию; ссылка с commit и без него. Без лимитов слов (Q5).
- Contract: пункт меню, если меню покрыто contract-test-ом (`test/contract/view-menu.test.ts`).
- e2e: новый `test/e2e/guide.spec.ts`: открыть из меню и палитры, переключить язык, закрыть. Сравнения по пикселям нет (Q21).

## Где в коде

- `src/renderer/guide/` (новая папка), `src/renderer/shell/AppShell.tsx`, `src/renderer/palette/commands.ts`, `src/main/menu.ts`, `src/shared/settings/app-settings.ts`, `scripts/guide-lag.mjs`, `docs/adr/`, `docs/design/F-SPEC.md`.

## Вне скоупа

- Набор сцен и настоящие Topic-и.
- Ссылки из Getting started и First run: Ticket 09.

## Итог
