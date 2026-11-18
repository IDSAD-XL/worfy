# 04 — Иконка Health check на rail над Machines, строка palette, порядок строк и кнопка Fix

Type: task
Status: claimed 2026-11-18T20:55Z
Blocked by: 03
Source: [spec.md](../spec.md), «Ticket-ы», 4; «Решение», пункты 3 и 6; «Уровни: проверка → уровень», цвет иконки;
«Решения по реализации», 2; «Решения по test-ам», e2e; «Решения владельца», Q1, Q3, Q4, Q9; «Волны», Wave 2 и
пересечение с `worfy-pr-follow`

Кто: агент.

Не платформенный Ticket (renderer). Глубина ревью — `medium`; снимок экрана rail с точкой и Settings → Health.

Не стартует, пока не слит `worfy-pr-follow` 05 (Ticket Node и Command palette): оба правят
`src/renderer/palette/commands.ts` (spec, «Волны»).

## Что происходит

- Rail sidebar: вкладки — `ordered.map(tab)` в `role="tablist"` (`src/renderer/shell/Sidebar.tsx:157-159`), кнопка
  Settings — вне tablist (`:160-161`). Вкладка Machines — `order = 15`, `railTitle = 'Machines'`, `railEnd = true`
  (`src/renderer/shell/sidebar/MachinesSection.tsx:19-21`); её владелец назвал «Devices».
- Точка на кнопке rail — `RailBadgeMark` (`Sidebar.tsx:40-44`, класс `w-sidebar__rail-dot` с `data-tone`); тона
  `RailBadge` — `working | blocked | ready | muted` (`src/renderer/shell/sidebar-scope.ts:106`), стили —
  `src/renderer/shell/shell.css:167-185`. Жёлтого тона нет; токены цвета — `src/renderer/theme/tokens.css` (ui-kit,
  ADR-0106).
- Settings → Health — `HealthSection` (`src/renderer/settings/HealthSection.tsx:11-12`, проверяет при открытии:
  `checkOnShow`, `:23`). Окно Settings открывает `openSettings(sectionId)`
  (`src/renderer/settings/settings-window.ts:32`).
- Command palette: строка «First-run checks» открывает окно First run (`src/renderer/palette/commands.ts:357-367`).
- Строки рисует `src/renderer/shell/FirstRunChecks.tsx` в порядке `CHECKS`; уровня и кнопки Fix нет.
- Ticket 03 дал `severity`, статус `unknown`, выводимое состояние, худший уровень и событие изменения отчёта.

## Что делаем

1. Кнопка Health check на rail над Machines в `src/renderer/shell/Sidebar.tsx`. Это не вкладка sidebar: она ничего не
   показывает в sidebar, а открывает Settings → Health. Кнопка не входит в `role="tablist"`; Ticket решает, как
   поставить её над вкладками `railEnd`, не ломая клавиатуру tablist (например, вкладки `railEnd` — во второй
   tablist под кнопкой). Tooltip — «Health check» (Q1) и причина точки.
2. Цвет — по худшему уровню (Q3): красная точка — critical не в `ok`; жёлтая — только non-critical; без точки — всё
   `ok`; серое кольцо — первого отчёта нет или идёт «Check again». `unknown` никогда не красит в красный: tooltip
   «Couldn't check: <reason>». Вид точки — как `RailBadgeMark`; жёлтый тон — из токенов ui-kit, а нет его — добавить
   в `tokens.css`. Иконка видна всегда; отражает Machine и все открытые Project-ы (Q4). Toast и системных уведомлений нет
   (Q9).
3. `openHealthCheck()` в `src/renderer/settings/settings-window.ts`: `openSettings('HealthSection')`. Её берут кнопка
   rail, строка palette и ссылки Ticket-ов 07 и 08.
4. `src/renderer/shell/FirstRunChecks.tsx`: сначала critical не в `ok`, затем non-critical не в `ok`, затем `ok`;
   метка уровня у строки; группа Projects по Project-ам; кнопка Fix у строки `fixable` (кнопка с пометкой `safe`);
   строка `unknown` — «Couldn't check: <reason>».
5. `src/renderer/palette/commands.ts`: строка «Health check» открывает Settings → Health; «First-run checks» остаётся для
   окна First run (Q1).
6. Английские страницы: `docs/features/app-shell.md` (иконка на rail, цвета, palette), `docs/features/onboarding.md`
   (Settings → Health: уровни, порядок, Fix; First run не открывается на строках Project-а). Перевод — Ticket 09.

## Готово, когда

- [ ] Unit test (новый `test/unit/health-rail-button.test.tsx`): точка красная при critical не в `ok`, жёлтая при
      non-critical, нет точки при всех `ok`, серое кольцо до первого отчёта; `unknown` не красный, tooltip «Couldn't
      check: …»; щелчок зовёт `openHealthCheck()`.
  - evidence: test-run pass · `pnpm test` test/unit/health-rail-button.test.tsx exit 0 · mac - · b2ac640c4
- [ ] Unit test (`test/unit/settings-health.test.tsx`): порядок строк — critical, non-critical, `ok`; метка уровня;
      кнопка Fix только у `fixable`.
  - evidence: test-run pass · `pnpm test` test/unit/settings-health.test.tsx exit 0 · mac - · b2ac640c4
- [ ] Unit test (`test/unit/palette-commands.test.tsx`): строка «Health check» открывает Settings → Health; «First-run
      checks» по-прежнему открывает First run.
  - evidence: test-run pass · `pnpm test` test/unit/palette-commands.test.tsx exit 0 · mac - · b2ac640c4
- [ ] e2e test (`test/e2e/sidebar-rail.spec.ts` или `test/e2e/settings-health.spec.ts`): иконка над Machines, щелчок
      открывает Settings → Health; palette «Health check» — то же. Без реальной сети.
- [ ] Все unit и contract test-ы модуля зелёные: `test/unit/settings-health.test.tsx`, `test/unit/first-run-dialog.test.tsx`,
      `test/unit/first-run-concepts.test.tsx`, `test/unit/palette-commands.test.tsx`, `test/unit/sidebar-scope.test.tsx`,
      `test/unit/sidebar-section.test.tsx`, `test/unit/machines-section.test.tsx`.
  - evidence: test-run pass · `pnpm test` the unit and contract files of the module exit 0 · mac - · b2ac640c4
- [ ] Снимок экрана rail с точкой и Settings → Health — в «Итог» (снимок ревью — в scratchpad, в репозиторий не
      кладётся).
- [ ] Английские страницы `app-shell.md` и `onboarding.md` описывают иконку, уровни и строку palette.
  - evidence: commit pass · worfy-auth-check/04: Health check button on the rail, row order, level and Fix, palette row · - - · b2ac640c4
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/renderer/shell/Sidebar.tsx`, `src/renderer/shell/shell.css`
- `src/renderer/theme/tokens.css` (жёлтый тон, если его нет)
- `src/renderer/settings/settings-window.ts` (`openHealthCheck`)
- `src/renderer/shell/FirstRunChecks.tsx`
- `src/renderer/palette/commands.ts`
- `docs/features/app-shell.md`, `docs/features/onboarding.md`
- `test/unit/health-rail-button.test.tsx` (новый), `test/unit/settings-health.test.tsx`,
  `test/unit/palette-commands.test.tsx`, `test/e2e/sidebar-rail.spec.ts`, `test/e2e/settings-health.spec.ts`

Только читать: `src/shared/health/severity.ts`, `src/shared/ipc/first-run.ts` (Ticket 03),
`src/renderer/shell/sidebar/MachinesSection.tsx`, `src/renderer/shell/sidebar-scope.ts`.

## Вне скоупа

- Новые вкладки sidebar, панели и экраны.
- Строки GitHub access, Codex, Browser, Link — Ticket-ы 05–08; ссылки «Open Health check» в фичах — 07 и 08.
