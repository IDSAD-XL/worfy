# 05 — worfy читает Evidence

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Модель» (весь раздел), «Что есть сейчас» (разбор «Готово, когда» в worfy, двойные правила), «Решено без владельца», п. 1, 3, 6, 7

## Что происходит

- worfy разбирает раздел «Готово, когда» только ради ручных пунктов: `manualChecks` (`src/shared/workflow/manual-checks.ts:22`)
  → поле `manualChecks` модели Ticket-а (`src/shared/workflow/types.ts:67-74`, `:90`), заполняет `reader.ts`
  (`src/main/workflow/reader.ts:332-335`).
- После 01 грамматика строки Evidence и правила состояния есть в `harness/lib/evidence.cjs`. Пример двойных правил с test-ом
  согласия — Pipeline (`test/contract/pipeline-rules-agree.test.ts:1`, `:16`).

## Что делаем

1. **`src/shared/workflow/evidence.ts`** — чистый модуль (без Node и DOM): `evidenceItems(markdown, headings)` → пункты с полями
   01 и состоянием `verified | not-verified | failed` с причиной; `evidenceSummary(items)` → `{ verified, total, failed }`.
2. **`src/shared/workflow/types.ts`** — `evidenceItemSchema` и необязательное поле `evidence` модели Ticket-а (нет поля — нет
   пунктов: модель старого worfy с Linked machine-а остаётся валидной, как у `manualChecks`).
3. **`src/main/workflow/reader.ts`** — заполняет `evidence` из того же `markdown`, что и `manualChecks`, без второго чтения файла.
4. **`repoUrl` модели workflow** — страница репозитория Project-а из `origin` его корня тем же `repoPageUrl`
   (`src/main/flight-recorder/github.ts:39`), что у Run history (`src/main/flight-recorder/service.ts:578-579`); нет такого
   `origin` — null. Нужна матрице 06 для ссылок на commit и PR.
5. **`test/contract/evidence-rules-agree.test.ts`** — один набор fixture-Ticket-ов 01 (`harness/bin/tests/fixtures/evidence/`)
   разбирают `evidence.cjs` и `evidence.ts`: пункты, строки, состояния и причины совпадают.

worfy ничего не пишет в файл Ticket-а (ADR-0002).

## Готово, когда

- [ ] Unit test `evidence`: все правила состояния spec-а (последний `fail`, только `review`, `needs` с несовпадением платформы и
      копии, ручной пункт, неразобранная строка, code fence) — таблицей.
- [ ] Contract test согласия на fixture-ах 01 — зелёный; мутация правила в одной копии делает его красным.
- [ ] Contract test `workflow-reader`: у Ticket-а fixture-проекта есть `evidence`, у Ticket-а без раздела — пустой список;
      `manualChecks` не изменились (строки Evidence не попали в текст ручного пункта).
- [ ] Contract test: reader не пишет в папку Project-а (ADR-0005).
- [ ] Contract test `workflow-reader`: `repoUrl` — `https://github.com/<owner>/<repo>` у fixture-репозитория с GitHub `origin`, null без `origin`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/evidence.test.ts` (новый).
- Contract `test/contract/evidence-rules-agree.test.ts` (новый), `test/contract/workflow-reader.test.ts` — новые случаи.
- Сначала падающий: contract test согласия — модуля `evidence.ts` нет.
- Прогнать `test/unit/manual-checks.test.ts`, `test/unit/palette-commands.test.tsx`, `test/unit/palette-manual-check-row.test.tsx`,
  `test/contract/workflow-*.test.ts`.

## Где в коде

- `src/shared/workflow/evidence.ts` (новый)
- `src/shared/workflow/types.ts`
- `src/main/workflow/reader.ts`
- `test/unit/evidence.test.ts` (новый)
- `test/contract/evidence-rules-agree.test.ts` (новый)
- `test/contract/workflow-reader.test.ts`

Только читать: `src/main/flight-recorder/github.ts` (`repoPageUrl`), `harness/lib/evidence.cjs`, `harness/bin/tests/fixtures/evidence/`, `src/shared/workflow/manual-checks.ts`,
`src/shared/workflow/doc-headings.ts`.
