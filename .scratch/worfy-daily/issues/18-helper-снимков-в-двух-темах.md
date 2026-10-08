# 18 — Helper снимков в двух темах

Type: task
Status: done — 2026-10-06, [PR #75](https://github.com/IDSAD-XL/worfy/pull/75)
Blocked by: 17
Source: [spec.md](../spec.md), тема F; [F-SPEC.md](../../../docs/design/F-SPEC.md)

## Что делаем

Нестабильные e2e раньше были частью этого Ticket-а. Решением владельца 2026-10-06 они вынесены в
Ticket 21, который идёт в Wave 1. Здесь остался только helper снимков.

**Helper снимков** (тема F): `test/e2e/snapshots.ts`.

- Один вызов снимает окно `page.screenshot()` в светлой и тёмной теме через
  `window.emulateMedia({ colorScheme })` — так уже делают `canvas-layout.spec.ts:161` и
  `session-controls.spec.ts:115`.
- Снимки кладутся в папку `snapshots/<имя>/` внутри папки вывода Playwright.
- Ревьюер UI-Ticket-а сверяет их с F-SPEC. Само правило ревью вносит в skill workflow
  проектирования, не этот Ticket.

## Готово, когда

- [x] Один вызов helper-а снимков даёт два PNG — light и dark. e2e проверяет, что оба файла есть и различаются.

## Тесты

- `test/e2e/snapshots.spec.ts` (новый) — helper снимков.
- Сначала падающий test: `snapshots.spec.ts` ждёт два различающихся PNG и падает, пока helper-а нет.

## Где в коде

- `test/e2e/snapshots.ts` (новый)
- `test/e2e/snapshots.spec.ts` (новый)

## Итог

- Helper — `snapshotThemes(window, name)` в `test/e2e/snapshots.ts`. Один вызов пишет
  `light.png` и `dark.png` в `snapshots/<name>/` внутри папки вывода Playwright
  (`test.info().project.outputDir`; она очищается в начале каждого прогона) и возвращает оба пути. Тема переключается
  `window.emulateMedia({ colorScheme })`; после вызова эмуляция снимается (`colorScheme: null`), и
  страница снова следует теме приложения. CSS transitions на время снимка выключены
  (`animations: 'disabled'`). Имя с путём (`''`, `.`, `..`, `a/b`) helper отклоняет.
- **Боковая панель и vibrancy.** Проверено на собранном приложении: `emulateMedia` перекрашивает CSS-слой
  боковой панели (`--sidebar-translucent`) в обеих темах, но сам vibrancy окна в снимок не попадает
  ни при каком способе — ни `page.screenshot()`, ни `BrowserWindow.capturePage()`, ни через
  `nativeTheme.themeSource`. Без подложки боковая панель в PNG полупрозрачна (alpha 204 в светлой,
  209 в тёмной), и просмотрщик показывает под ней свой фон. Поэтому helper на время снимка
  подкладывает под страницу непрозрачный token `--sidebar` текущей темы (F-SPEC, «Tokens») — он
  заменяет vibrancy. Решено без владельца, подтвердить: снимок показывает боковую панель цветом
  token-а, а не настоящим vibrancy поверх рабочего стола.
- Test `test/e2e/snapshots.spec.ts`: оба файла есть и различаются; боковая панель в обоих PNG
  непрозрачна, светлая в light и тёмная в dark; после вызова страница снова следует теме
  приложения; имя с путём отклоняется. Каждую из четырёх частей helper-а (подложка, переключение
  темы, снятие эмуляции, проверка имени) по отдельности ломал мутант, и test краснел.
- Снимки helper-а на пустом приложении: [светлая](../evidence/18-snapshot-helper-light.png),
  [тёмная](../evidence/18-snapshot-helper-dark.png).
- Ревью ([PR #75](https://github.com/IDSAD-XL/worfy/pull/75), VERIFIED, без доработки): цвет
  `--sidebar` на снимке совпадает с F-SPEC:23 (`sidebar` — #E9E9EC в светлой теме, #161513 в тёмной);
  мутанты всех четырёх частей helper-а пойманы; пороги яркости в test-е не зависят от дисплея.
  Долг [low]: `test/e2e/snapshots.ts:47` — нет test-а, что подложка уходит со страницы после снимка
  (мутант, который оставляет её через `addStyleTag`, выживает).

### Долги из HANDOFF (2026-10-08)

- Вне Ticket-а (раздел out_of_scope отчёта исполнителя): `test/e2e/canvas-layout.spec.ts:163` и
  `test/e2e/session-controls.spec.ts:119`, `:185` — свои циклы снимков в двух темах; можно перевести на
  `snapshotThemes`.
