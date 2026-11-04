# 52 — Model и Effort пусты в заголовке Session на Codex

Type: bug
Status: done 2026-11-04T10:12Z
PR: #1352
Blocked by:
Source: владелец 2026-11-04, приёмка worfy-multi-vendor 32 на Mac Stable `460fb561`, снимок Session на Codex

## Что происходит

В заголовке Session на Codex стоит «Model» без значения и «Effort –», хотя в поле ввода выбраны
«Default (GPT-6.1-Sol)» и «default»; ходы в Session уже были. У Session на Claude заголовок показывает модель и effort.

- Model: заголовок (`src/renderer/session/SessionView.tsx:209`, `:267-277`) берёт `model` из последнего `init`.
  Driver Codex шлёт `init` только на `turn/started` (`src/main/vendors/codex/items.ts:175-176`, `:204-215`,
  `model: context.model()`); при выборе «Default» значение, видимо, пустая строка, а `model ?? '—'` пустую строку
  не заменяет — ячейка пустая. Вне `init` модель до заголовка не доходит.
- Effort: `settings?.effort ?? '—'` (`SessionView.tsx:278-283`); при «Default» он null. Picker знает default
  модели из `model/list` (`defaultReasoningEffort`, `src/main/vendors/codex/session.ts:528`), заголовок — нет.
  Tooltip «Claude Code does not report the level it applies» (`:279`) — только про Claude.

## Что делаем

1. Model в заголовке Codex — настоящая модель, которой идёт Session: при «Default» — модель с `isDefault` из
   `model/list` (`session.ts:518-523` уже её находит); `init` несёт её, а не пустую строку. Пустая строка в
   заголовке читается как неизвестная («—»), как null.
2. Effort при «Default» — default effort этой модели (как в picker-е), с пометкой, что это default.
   Tooltip — по Vendor-у.
3. Claude — как сейчас (test-ы Claude без правок ожиданий). Cost «–» у обычной Session — как задумано
   (`docs/features/sessions.md:134-135`), не трогаем.

Глубина review — `medium`.

## Готово, когда

- [ ] Unit test заголовка Session на Codex: модель и effort при «Default» и при выбранных; пустая строка → «—».
  - evidence: test-run pass · `pnpm test test/unit/session-view.test.tsx` exit 0 · mac - · 2b9765ab0f7dae37fdbc872e196bd58851eef700
- [ ] Contract test driver-а Codex: `init` при «Default» несёт модель из `model/list`.
  - evidence: test-run pass · `pnpm test test/contract/codex-session.test.ts` exit 0 · mac - · 2b9765ab0f7dae37fdbc872e196bd58851eef700
- [ ] Снимок заголовка Session на Codex в обеих темах в `.scratch/worfy-polish/evidence/52/`.
  - evidence: screenshot pass · `../evidence/52/52-codex-header-dark.png` · mac dev · 2b9765ab0f7dae37fdbc872e196bd58851eef700 · scrub: 2026-11-04
  - evidence: screenshot pass · `../evidence/52/52-codex-header-light.png` · mac dev · 2b9765ab0f7dae37fdbc872e196bd58851eef700 · scrub: 2026-11-04
- [ ] Все unit и contract test-ы Session renderer-а и codex-*, `pnpm typecheck`, `pnpm lint` — exit 0.
  - evidence: test-run pass · `pnpm test` of 41 files codex-*, session-view*, *settings* exit 0; `pnpm typecheck` exit 0; `pnpm lint` exit 0 · mac - · 2b9765ab0f7dae37fdbc872e196bd58851eef700

## Итог

**Причина.** Thread на «Default» Codex начинает с пустой моделью: `thread/start` отвечает `model: ""`, и `init` хода
нёс эту пустую строку — ячейка Model была пустой (`model ?? '—'` пустую строку не заменяет). Effort при «Default» —
null, и заголовок показывал «—», хотя Codex идёт на default effort модели из `model/list`.

**Что сделано.**
- Driver Codex (`src/main/vendors/codex/session.ts`, `overrides`): если thread не назвал модель, `init` хода
  называет модель с `isDefault` из `model/list`; `turn/start` модель по-прежнему не шлёт.
- Строки picker-а модели (`codexModelOptions`, `src/main/vendors/codex/capabilities.ts`) несут `defaultEffort` —
  `defaultReasoningEffort` модели; поле `ModelOption.defaultEffort` в `src/shared/agent/settings.ts` необязательное,
  у Claude его нет.
- Заголовок (`src/renderer/session/header-facts.ts`, `SessionView.tsx`): пустое имя модели — «—», как null. Session на
  Codex без выбранного effort показывает default effort модели, приглушённым текстом (`data-default="true"`), с
  tooltip про Codex. Выбранный effort — как раньше, tooltip «The level worfy asked Codex for». Session на Claude —
  текст и tooltip без изменений.
- Страница `docs/features/vendors.md` — две фразы о заголовке Session на Codex.

**Проверка.** Unit `test/unit/session-view.test.tsx` (модель и effort при «Default» и при выбранных, пустая строка →
«—», Claude без изменений), `test/unit/codex-capabilities.test.ts`; contract `test/contract/codex-session.test.ts`
(сценарий `test/fixtures/codex-scripts/default-model.jsonl`: `init` несёт `gpt-5.5-codex`, `turn/start` — без модели);
e2e `test/e2e/codex-session.spec.ts` — новый test: модель после хода, effort `medium` с пометкой default, при окне
1280 px у имени модели остаётся место.

Снимки: [тёмная тема](../evidence/52/52-codex-header-dark.png), [светлая тема](../evidence/52/52-codex-header-light.png).

**Решено без владельца.** Оба пункта подтверждено владельцем 2026-11-04.
- Пометка default у effort — приглушённый текст и tooltip, а не « (default)» в тексте. С « (default)» ячейка Effort
  шире на ~70 px, и при окне по умолчанию (1280 px) имя модели сжималось до нуля — ячейка Model снова пустая.
- До первого хода Session на «Default» модель в заголовке — «—»: `init` приходит только с ходом, а `thread/start`
  её не называет.
