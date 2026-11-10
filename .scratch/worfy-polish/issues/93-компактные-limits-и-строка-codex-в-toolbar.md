# 93 — Компактные Limits по Vendor-ам и строка Codex отдельной третьей строкой колонки Harness

Type: polish
Status: claimed 2026-11-10T09:14Z
PR: —
Blocked by: —
Source: просьба владельца 2026-11-10 по снимку экрана Mac Stable (через Orchestrator).

## Что происходит

Правая часть toolbar-а сейчас, слева направо: логотип Claude и два индикатора Limits рядом друг с другом
(«5-hour 101% / 19:00» и «7-day 26% / Mon 06:00»: у каждого строка «label + процент», полоска и время сброса),
логотип Codex и два его индикатора рядом («5h 0% / 16:02», «weekly 19% / Wed 23:57»), затем колонка текста
«Harness 0.3.0+2d591… · Codex: approve ho…» (обрезана) над «v0.3.1826  1.3 GB», затем поле «Search or run… ⌘K».

Индикаторы Limits широкие: каждый — три строки, поставленные рядом. Часть Codex стоит в одной строке с Harness и
обрезает её.

## Что делаем

1. Индикаторы Limits каждого Vendor-а стоят друг под другом, по одной компактной строке на окно: label, процент,
   время сброса и тонкая полоска под ними. Колонки label / процент / время выровнены между двумя строками секции.
   Секция Vendor-а становится заметно уже. Вся информация и все tooltip-ы остаются; цвет предупреждения выше 100%
   (и на 60% / 85%) остаётся. Так же — когда Vendor один.
2. Часть Codex («Codex: approve hooks», «Codex: not installed», «Codex <from>», «Codex error: …», «Codex: N agents
   not written») уходит из строки Harness и становится третьей строкой колонки, под строкой версии; её кнопка
   (Install in Codex, Update Harness in Codex, Retry) — в этой же строке. Строка Harness больше ею не обрезается.
3. Высота toolbar-а (52 px) не меняется. Если три строки не помещаются шрифтом 11 px — шрифт колонки меньше; что
   выбрано — в «Итог». Проверить в окне 1280 px и 1600 px и с одним Vendor-ом.
4. Правило узкого окна (до 1100 px, worfy-polish 48: только значения) и отступы сегментов View до 1400 px
   (worfy-pr-inbox 03) работают как раньше.
5. Страницы `docs/features/transcripts-and-usage.md` (Limits) и `docs/features/harness.md` (toolbar item, часть
   Codex) и их перевод в `docs/features/ru/` описывают новую раскладку.

## Готово, когда

- [ ] Два окна Limits одного Vendor-а — друг под другом (y второго больше, x одинаковый), секция Vendor-а уже
      прежней; ширины до и после — в «Итог». Проверяет `test/e2e/limits-vendors.spec.ts` в окне 1280 px и 1600 px.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/limits-vendors.spec.ts test/e2e/codex-hooks-step.spec.ts test/e2e/limits.spec.ts test/e2e/toolbar.spec.ts test/e2e/update-toolbar.spec.ts test/e2e/harness-install.spec.ts test/e2e/first-run.spec.ts` exit 0 · mac - · bbc852378
- [ ] Значение, label, время сброса и tooltip-ы (`5-hour: 62% · resets 07:10`, `resets Mon 09:00`) не изменились;
      `data-level` и цвет `blocked` для значения выше 100% остаются. Проверяет `test/unit/limits-meter.test.tsx`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/limits-meter.test.tsx test/unit/harness-status.test.tsx test/unit/codex-hooks-step.test.tsx` exit 0 · mac - · bbc852378
- [ ] С одним Vendor-ом секция Claude Code тоже в две строки, заголовок «Limits» на месте. Проверяют unit test и
      `test/e2e/limits.spec.ts`.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/limits-vendors.spec.ts test/e2e/limits.spec.ts` exit 0 · mac - · bbc852378
- [ ] Часть Codex — третья строка колонки Harness (`harness-codex-line`), под строкой версии, внутри toolbar-а
      высотой 52 px; строка Harness её не содержит. Проверяют `test/unit/harness-status.test.tsx` и
      `test/e2e/codex-hooks-step.spec.ts` в окне 1280 px и 1600 px.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/codex-hooks-step.spec.ts` exit 0 · mac - · bbc852378
- [ ] Снимки toolbar-а в 1280 px и 1600 px (оба Vendor-а и «Codex: approve hooks») — в scratchpad, пути в отчёте.
- [ ] Страницы `docs/features` (en и ru) описывают новую раскладку.
  - evidence: commit pass · Stack each Vendor's Limits one line per window; Codex part as the Harness column's third line (worfy-polish 93) · - - · bbc852378
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast зелёный; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · bbc852378

## Где в коде

- `src/renderer/shell/toolbar/LimitsMeter.tsx` — панель Limits, секции по Vendor-ам.
- `src/renderer/limits/LimitBar.tsx` — одно окно Limits.
- `src/renderer/shell/toolbar/HarnessStatus.tsx` — колонка Harness: строка Harness, строка версии, часть Codex.
- `src/renderer/shell/shell.css` — ширины полосок, правила до 1400 px и до 1100 px, кнопки колонки.
- `test/unit/limits-meter.test.tsx`, `test/unit/harness-status.test.tsx`.
- `test/e2e/limits-vendors.spec.ts`, `test/e2e/limits.spec.ts`, `test/e2e/toolbar.spec.ts`,
  `test/e2e/codex-hooks-step.spec.ts`.
- `docs/features/transcripts-and-usage.md`, `docs/features/harness.md`, `docs/features/vendors.md` и их перевод в
  `docs/features/ru/`.

## Вне скоупа

- Тексты label-ов окон (`5-hour`, `7-day`, `5h`, `weekly`) и расчёт значений в `src/shared/agent/limits.ts`.
- Высота toolbar-а и остальные его элементы.

## Итог

**Limits.** Окна одного Vendor-а стоят друг под другом в CSS grid `w-limits-stack` (`src/renderer/shell/shell.css`):
каждое окно — строка этого grid-а через subgrid, колонки label / значение (по правому краю) / время сброса выровнены, под
строкой — полоса 2 px. Строка сброса — только время (`Fri 11:19`), tooltip — вся строка (`resets Fri 11:19`); так же и с
одним Vendor-ом (раньше там было `resets …`). Цифры — шрифт UI с `tabular-nums` вместо mono. Vendor больше чем с двумя
окнами получает второй столбец из двух. Цвет `blocked` для 101% остаётся (`test/unit/limits-meter.test.tsx`).

**Ширина секции Vendor-а** (логотип + окна), Mac, окно 1280 px: до — 172 px (логотип 12 + две полосы по 72 + отступы);
после — Claude 125 px, Codex 128 px, то есть около 73% прежней, не половина. Шрифт 11 px давал 133 px, поэтому выбран
10 px. Ближе к половине можно прийти только короткими label-ами в toolbar-е (`5h`/`7d` вместо `5-hour`/`7-day`) — это
вопрос владельцу, в тикете не сделано.

**Колонка Harness.** Часть Codex — третья строка (`harness-codex-line`) под строкой версии, со своей кнопкой; разделитель
`· ` убран. Шрифт остался 11 px: с тремя строками строка Harness и кнопки-иконки — 16 px вместо 20, итого 16 + 13 + 16 =
45 px из 52. Высота toolbar-а — 52 px в 1280 px и 1600 px (`test/e2e/codex-hooks-step.spec.ts`).

**Проверки.** `test/e2e/limits-vendors.spec.ts` (оба Vendor-а и один Claude Code, 1280 и 1600 px),
`test/e2e/codex-hooks-step.spec.ts`, `test/e2e/limits.spec.ts`, `test/e2e/toolbar.spec.ts` (узкое окно 800 px и 1600 px),
`test/e2e/update-toolbar.spec.ts`, `test/e2e/harness-install.spec.ts`, `test/e2e/first-run.spec.ts` — 25 passed.
