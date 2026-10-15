# 22 — Убрать блок Limits из правой колонки Session view: он повторяет Limits в toolbar

Type: task
Status: claimed — 2026-10-15
Blocked by: —
Source: слово владельца 2026-10-15 (через Orchestrator-а): «В той же правой колонке убрать секцию
лимитов: она дублирует то, что уже показано в шапке (header)». Блок добавил Ticket
[`worfy-mvp` 22](../../worfy-mvp/issues/22-лимиты.md).

## Что происходит

Toolbar — шапка окна worfy. Она видна и над Canvas, и над Session view: переключатель Canvas /
Session живёт в ней (`src/renderer/shell/Toolbar.tsx:52-96`).

- **В toolbar — Limits.** `LimitsMeter` (`src/renderer/shell/toolbar/LimitsMeter.tsx:14-28`, `order =
  100`): подпись «Limits», две полосы — окно 5 часов и окно 7 дней — с долей, временем сброса и
  «as of», если данные старые. Полоса — `LimitBarView`, вариант `toolbar`
  (`src/renderer/limits/LimitBar.tsx:57-84`).
- **В rail — то же самое.** `LimitsRail` (`src/renderer/session/rail/LimitsRail.tsx:12-41`, `order =
  90`) рисует те же полосы из того же состояния: `limitBars(useLimits(), useNow())`, вариант `rail`
  (`LimitBar.tsx:35-55`).
- **Что rail показывает сверх toolbar.** Данных — ничего: источник, окна, доли, время сброса и «as of»
  одни и те же (`limitBars`). Отличается только вид:
  - в rail время сброса и «as of» стоят полностью в одну строку (`LimitBar.tsx:44-48`);
  - в toolbar полоса шириной 104 px, и эти строки могут кончиться многоточием; полный текст — в
    подсказке (`LimitBar.tsx:57-59`, `:77-81`);
  - полоса в rail толще: 6 px против 4 px (`:51`, `:76`).
  Владелец 2026-10-15: убрать; полного текста в подсказке шапки хватает.

## Что делаем

1. **Сначала красный test** в `test/unit/session-rail-discovery.test.tsx`: среди блоков rail нет
   `LimitsRail` (сейчас `:36` его ждёт). На main красный.
2. **Удалить** `src/renderer/session/rail/LimitsRail.tsx`. Rail находит блоки сам (`import.meta.glob`,
   `rail/index.ts`), других правок для этого не нужно.
3. **Убрать вариант `rail`** у `LimitBarView` (`LimitBar.tsx:16`, `:35-55`), если его больше никто не
   зовёт; тип `LimitBarVariant` — по месту.
4. **Комментарии, которые называют блок**, — переписать:
   `LimitBar.tsx:4-6`, `src/renderer/shell/toolbar/LimitsMeter.tsx:5-8`,
   `src/renderer/limits/useLimits.ts:1`, `src/renderer/session/rail/BindingRail.tsx:16`,
   `src/renderer/session/rail/SubagentsRail.tsx:15`, `src/renderer/session/rail/index.ts:9`.
5. **Test-ы.** `test/unit/limits-meter.test.tsx`: блок `describe('LimitsRailView')` (`:41-58`) уходит,
   test-ы `LimitsMeterView` остаются.
6. **Снимки** Session view после правки — светлая и тёмная тема: rail без Limits, Limits в toolbar —
   `.scratch/worfy-polish/evidence/22-*.png`.

## Готово, когда

- [x] Test пункта 1 красный на main и зелёный с правкой.
- [x] `grep -rn "LimitsRail\|limits-rail" src test` — пусто (кроме `test/fixtures`, это копия старого
      Epic-а).
- [x] Limits в toolbar работают как раньше: test-ы `LimitsMeterView` зелёные без правок ожиданий.
- [x] Снимки в светлой и тёмной теме — ссылки в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `test/unit/session-rail-discovery.test.tsx` — состав блоков rail.
- `test/unit/limits-meter.test.tsx` — только toolbar.
- Мутант: вернуть файл `LimitsRail.tsx` — test пункта 1 красный.

## Где в коде

- `src/renderer/session/rail/LimitsRail.tsx`
- `src/renderer/limits/LimitBar.tsx`
- `src/renderer/limits/useLimits.ts`
- `src/renderer/shell/toolbar/LimitsMeter.tsx`
- `src/renderer/session/rail/BindingRail.tsx`
- `src/renderer/session/rail/SubagentsRail.tsx`
- `src/renderer/session/rail/index.ts`
- `test/unit/limits-meter.test.tsx`
- `test/unit/session-rail-discovery.test.tsx`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/renderer/shell/Toolbar.tsx`, `src/shared/agent/limits.ts`, `src/renderer/session/SessionView.tsx`.

## Вне скоупа

- Limits в toolbar: вид и данные не меняются.
- Блок Subagent-ов — Ticket 21 (общий файл `SubagentsRail.tsx`, только комментарий; 22 идёт после 21).
- `test/fixtures/worfy-mvp-epic/` — копия старого Epic-а для test-ов, не правится.

## Итог

- Блок Limits в rail Session view удалён: файла `src/renderer/session/rail/LimitsRail.tsx` больше
  нет, rail находит только `BindingRail` и `SubagentsRail`. Limits видны только в toolbar.
- `LimitBarView` потерял вариант `rail` и проп `variant` вместе с типом `LimitBarVariant`: других
  вызовов, кроме toolbar, не осталось. Вид полос в toolbar не менялся. Решено без владельца,
  подтвердить.
- Комментарии, которые называли блок, переписаны: `LimitBar.tsx`, `LimitsMeter.tsx`,
  `useLimits.ts`, `BindingRail.tsx`, `SubagentsRail.tsx`, `rail/index.ts`.
- Test: `test/unit/session-rail-discovery.test.tsx` — «has no Limits block» сравнивает весь
  список блоков rail; на main красный (в списке есть `LimitsRail`), с правкой зелёный; мутант
  «вернуть `LimitsRail.tsx`» — красный. Из `test/unit/limits-meter.test.tsx` ушёл блок
  `LimitsRailView`; test-ы `LimitsMeterView` не менялись и зелёные.
- e2e `limits.spec.ts` и `session-view.spec.ts` — зелёные. Снимки Session view сняты временным
  spec-ом (в репозиторий не вошёл): rail — Binding и Subagents, Limits — в toolbar.
  - светлая тема: [22-session-rail-no-limits-light.png](../evidence/22-session-rail-no-limits-light.png)
  - тёмная тема: [22-session-rail-no-limits-dark.png](../evidence/22-session-rail-no-limits-dark.png)
