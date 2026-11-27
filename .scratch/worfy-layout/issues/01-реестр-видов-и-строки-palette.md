# 01: Реестр видов и строки palette

Type: task
Status: claimed 2026-11-27T03:34Z
Branch: worfy-layout/01
Blocked by: None — can start immediately
Source: [spec.md](../spec.md), «Ticket-ы», 01; «Решения по реализации» («Реестр видов», «Бейджи», «Command palette»); «Решения по test-ам», Seam 1; «Волны», Wave 1

Кто: агент.

## Что строить

- Имена видов сейчас записаны трижды: `viewOptions` (`src/renderer/shell/Toolbar.tsx:34-120`), `VIEW_NAMES`
  (`src/renderer/shell/AppShell.tsx:80-89`) и строки View в Command palette (`viewCommands`,
  `src/renderer/palette/commands.ts:401-545`); строки для Pipeline в palette нет.
- Новый реестр видов `src/renderer/shell/views.tsx` — один список на все восемь `ShellView` (`Toolbar.tsx:24`).
  Header строит шесть сегментов из реестра в нынешнем порядке и с нынешним видом; `viewOptions` удаляется.
- Строки View в Command palette строятся из реестра; новая строка `view:pipeline` «Pipeline board».
- `VIEW_NAMES` пока остаётся: `AppShell.tsx` правит Ticket 03, а `VIEW_NAMES` убирает 04.
- Бейдж в реестре только у Acceptance, как сейчас на вкладке; бейджи Pull requests и Pipeline (`useBadge` из
  источников видов) — Ticket 04.

## Где в коде

- `src/renderer/shell/views.tsx` (новый)
- `src/renderer/shell/Toolbar.tsx` — `ShellView` `:24`, `viewOptions` `:34-120`, `SegmentedControl` `:165-174`,
  причины неактивности `:79-80`, `:94-95`, `openRunHistory` `:170-173`, бейдж Acceptance `:109-113`
- `src/renderer/palette/commands.ts` — `viewCommands` `:401-545`
- Только читать: `src/renderer/shell/AppShell.tsx` (`VIEW_NAMES` `:80-89`), `src/renderer/session/navigation.ts`
  (`setView` `:46`), `src/renderer/acceptance/useAcceptance.ts` (`useReadyCount` `:131`)

## Решения

spec.md, раздел «Решения по реализации», «Реестр видов» и «Command palette»:

- У каждой записи реестра:
  - `id` — значение `ShellView`; у Runs это `history`, как сейчас;
  - `area` — имя main area для `aria-label` (`Run history`, `Code story`, `Changes` — как в `VIEW_NAMES`);
  - `button` — только у шести View button-ов, у `story` и `changes` его нет:
    - `label` — видимая подпись: Canvas, Session, Pipeline, Runs, Pull requests, Acceptance;
    - `title` — tooltip: «Canvas», «Session view», «Pipeline board» (Q12), «Run history», «Pull requests of the open
      Project», «Checks that wait for you». Решено без владельца: у Pull requests и Acceptance tooltip-ы отличаются
      от одноимённых секций rail;
    - `Icon` — иконки из `viewOptions`, без изменений;
    - `needsProject` с причиной для tooltip-а неактивной кнопки: Runs — «Open a Project to see its Runs», Pull
      requests — «Open a Project to see its pull requests». Как сейчас (`Toolbar.tsx:79-80`, `:94-95`);
    - `useBadge()` — счёт или точка, tone и текст для tooltip-а и screen reader;
    - `open(project)` — по умолчанию `setView(id)` (`src/renderer/session/navigation.ts:46`). Runs —
      `openRunHistory(project.id)` (`Toolbar.tsx:170-173`), Acceptance — `openAcceptance()`, Pull requests —
      `openPrInboxOf(project.id, project.id)`, как строки palette сейчас.
- Бейдж Acceptance — счёт Ready to check по всем Project-ам (`useReadyCount`,
  `src/renderer/acceptance/useAcceptance.ts:131`), как сейчас на вкладке (раздел «Бейджи»).
- Command palette (Q6): строки View строятся из реестра, их id и тексты остаются: `view:canvas` «Switch to Canvas»,
  `view:session` «Switch to Session», `open-run-history` «Open Run history», `view:pull-requests` «Pull requests»,
  `view:acceptance` «Acceptance». Новая строка `view:pipeline` «Pipeline board». Строки «Reset layout» в palette нет.
- Тексты UI — английские (ADR-0074).

## Test-ы

- Unit `test/unit/view-registry.test.tsx` (новый): шесть кнопок, причины неактивности, Runs зовёт `openRunHistory` с
  id Project-а. Palette: строка у каждого из шести видов, `view:pipeline` есть (spec.md, «Решения по test-ам», Seam 1).
- Header выглядит как раньше: `test/e2e/toolbar.spec.ts`, unit `toolbar-runs`.
- Сначала падающий test: красный на старом поведении, это пишется в «Итог».
- `src/renderer/shell/` не описан в `scripts/e2e-specs.table.json`, поэтому PR запускает все spec-файлы e2e.
- Без моделей и без сети: агент — `WORFY_AGENT=fake`; настоящие Claude и Codex test-ы не запускают.

## Готово, когда

- [ ] Реестр задаёт id, подпись, tooltip, иконку, причину неактивности, бейдж и действие у шести видов; `viewOptions`
      удалён; header выглядит как раньше (`toolbar.spec.ts`, `toolbar-runs`).
- [ ] В Command palette есть строка у каждого из шести видов, `view:pipeline` открывает доску Pipeline.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
