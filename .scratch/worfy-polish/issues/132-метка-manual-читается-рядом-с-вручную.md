# 132 — Метка ручного пункта `(manual)` читается рядом с меткой Profile-а `вручную` в обеих копиях разбора

Type: bug
Status: done 2026-11-20T02:38Z
PR: #2050
Blocked by: none
Source: решение владельца 2026-11-20, Q4 раунда вопросов по spec-у `worfy-acceptance` («да»); бывший Ticket 01 spec-а
[worfy-acceptance](../../worfy-acceptance/spec.md), возражение 3 critic-а
[worfy-acceptance-2026-11-13](../../../docs/product/critic/worfy-acceptance-2026-11-13.md).

Кто: агент. Глубина review — `medium`. PR трогает `harness/lib/` — платформенный PR (ADR-0056): вердикт Windows — job-ы
Windows в CI.

## Что происходит

- Ручной пункт — пункт раздела «Готово, когда» Ticket-а с меткой в скобках после checkbox-а: его доказывает только
  строка Evidence `owner-check`, `screenshot` или `video` (`docs/features/evidence.md`, таблица состояний).
- Profile worfy задаёт метку `tickets.manual_mark` = `вручную` (`~/.claude/worfy-harness/projects/worfy/profile.json`).
  Метка по умолчанию — `manual`, старая русская — `вручную`.
- Обе копии разбора читают метку Profile-а и старую русскую, но не метку по умолчанию, когда метка Profile-а равна
  старой:
  - worfy: `accepted(value, old)` (`src/shared/workflow/doc-headings.ts:46-48`) возвращает `[value]`, когда
    `value === old`. Вызовы — `evidenceItems` (`src/shared/workflow/evidence.ts:168`) и `manualChecks`
    (`src/shared/workflow/manual-checks.ts:24`).
  - Harness: `accepted(value, fallback, old)` (`harness/lib/evidence.cjs:54-57`) — то же правило; вызов —
    `parseDoneSection` (`harness/lib/evidence.cjs:152-155`), его берёт `bin/ticket` (`ticket evidence`,
    `harness/bin/ticket:829-833`).
- Итог: для Project-а worfy пункт `- [ ] (manual) …` не ручной. Chip «Evidence n/m» и матрица считают его доказанным
  строкой `test-run`, строки ручных проверок Command palette его не показывают, `ticket evidence` пишет `manual: false`.
- 15 Ticket-ов на `5c1327f53` (2026-11-20) пишут неотмеченный пункт `(manual)`:
  - открытые приёмки: `worfy-changes-view` 07 (4 пункта), `worfy-code-stories` 17 (2), `worfy-mcp-live` 08 (1),
    `worfy-product-session` 15 (5);
  - `blocked` с `Waits: owner`: `worfy-product-session` 08, 21, 23 (по 1), `worfy-stuck-agents` 11 (3), 12 (2);
  - `done`: `worfy-code-stories` 14 (1), `worfy-mcp-live` 03, 05 (по 1), `worfy-product-session` 17 (3), 19 (1),
    `worfy-ui-kit` 19 (2).
- Общие случаи двух копий: `test/contract/evidence-rules-agree.test.ts` читает обеими копиями fixture-Ticket-ы
  `harness/bin/tests/fixtures/evidence/en/` и `ru/` и строки `grammar.json`. `grammar.json` — только грамматика строки
  Evidence, меток в нём нет; общие слова меток живут в fixture-Ticket-ах. Сейчас contract test читает их без Profile-а
  (метка по умолчанию `manual`), поэтому случай «Profile говорит `вручную`» он не видит.

## Что делаем

1. Правило в обеих копиях: метки ручного пункта — метка Profile-а, `manual` (по умолчанию) и `вручную` (старая), без
   повторов. В worfy — отдельная функция для меток (или `accepted` с третьим значением) в
   `src/shared/workflow/doc-headings.ts`; её зовут `evidence.ts:168` и `manual-checks.ts:24`. В Harness — то же в
   `harness/lib/evidence.cjs`. Заголовки разделов (`doneSection`, `trailSection`) не меняются.
2. Когда Ticket worfy-neutral 08 (убрать разбор старых русских слов) уберёт `вручную` из старых значений, `manual` всё
   равно читается: правило опирается на метку по умолчанию, а не на старую.
3. Новый fixture-Ticket `harness/bin/tests/fixtures/evidence/ru/03-manual-marks.md`: пункт `(вручную)`, пункт
   `(manual)`, пункт `(manual, needs: mac stable)`, неручной пункт.
4. `test/contract/evidence-rules-agree.test.ts`: обе копии читают fixture-Ticket-ы ещё и с `manualMark: 'вручную'` и
   дают одно и то же; пункт `(manual)` — `manual: true` в обеих.
5. Unit test-ы worfy: `test/unit/evidence.test.ts` и `test/unit/manual-checks.test.ts` — Profile с `вручную` видит
   пункт `(manual)` ручным, Profile с `manual` видит `(вручную)`.
6. Harness: `harness/bin/tests/ticket-evidence.test.sh` — Profile с `manual_mark: "вручную"`, `ticket evidence` для
   Ticket-а с `(manual)` показывает пункт ручным и отказывает строке `test-run` в доказательстве.
7. Сначала падающий test: красный на текущем `accepted`, это пишется в «Итог».
8. `docs/features/workflow.md:152-153` («The headings are the Profile's»): метка Profile-а, `manual` и старая русская
   читаются всегда. Перевод — в `docs/features/ru/workflow.md`.

## Готово, когда

- [ ] Unit test-ы `test/unit/evidence.test.ts` и `test/unit/manual-checks.test.ts`: пункт `(manual)` при Profile-е с
      `вручную` — ручной, `(вручную)` при Profile-е с `manual` — ручной; красные до правки.
  - evidence: test-run pass · `pnpm test` exit 0 (red before the fix) · mac - · 3ba43f182a9a5c93d626b3b4f694cfac05ed36d2
- [ ] Contract test `test/contract/evidence-rules-agree.test.ts` с fixture-Ticket-ом
      `harness/bin/tests/fixtures/evidence/ru/03-manual-marks.md`: обе копии дают одинаковые пункты с `manualMark`
      по умолчанию и `вручную`.
  - evidence: test-run pass · `pnpm test` exit 0 (test/contract/evidence-rules-agree.test.ts) · mac - · 3ba43f182a9a5c93d626b3b4f694cfac05ed36d2
- [ ] `harness/bin/tests/ticket-evidence.test.sh` — новый случай Profile-а с `вручную` зелёный; весь файл — exit 0.
  - evidence: test-run pass · `bash harness/bin/tests/ticket-evidence.test.sh` exit 0 · mac - · 3ba43f182a9a5c93d626b3b4f694cfac05ed36d2
- [ ] После merge `ticket evidence worfy-mcp-live 08` на main показывает пункт 2 ручным (вывод в «Итог»).
- [ ] `docs/features/workflow.md` и `docs/features/ru/workflow.md` описывают правило меток;
      `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · 3ba43f182a9a5c93d626b3b4f694cfac05ed36d2
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, job-ы Windows CI зелёные
      (платформенный PR).
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44655063359/job/136033490788 · ci - · 04372db24e622662b76a65cd4f2cb8fb84f83291

## Где в коде

- `src/shared/workflow/doc-headings.ts` (`accepted`, `OLD_DOC_HEADINGS`, `DEFAULT_DOC_HEADINGS`)
- `src/shared/workflow/evidence.ts:168`, `src/shared/workflow/manual-checks.ts:24`
- `harness/lib/evidence.cjs:42-57`, `:152-155`
- `harness/bin/tests/fixtures/evidence/ru/03-manual-marks.md` (новый)
- `test/contract/evidence-rules-agree.test.ts`, `test/unit/evidence.test.ts`, `test/unit/manual-checks.test.ts`,
  `harness/bin/tests/ticket-evidence.test.sh`
- `docs/features/workflow.md`, `docs/features/ru/workflow.md`

Только читать: `harness/bin/ticket:829-833`, `src/main/workflow/profile.ts` (откуда worfy берёт `manualMark`).

## Вне скоупа

- Переписать 15 Ticket-ов на метку `вручную`: правило читает обе.
- Заголовки разделов (`## Done when` рядом с `## Готово, когда`) — то же правило, но в них нет расхождения.
- Убрать разбор старых русских слов — Ticket worfy-neutral 08.

## Итог

- Правило меток ручного пункта в обеих копиях разбора: метка Profile-а, `manual` и `вручную`, без повторов.
  worfy — `manualMarks` в `src/shared/workflow/doc-headings.ts`, её зовут `evidenceItems` и `manualChecks`. Harness —
  `manualMarks` в `harness/lib/evidence.cjs`, её зовёт `parseDoneSection`. Заголовки разделов читаются по-прежнему.
- Сначала падающий test: на прежнем `accepted` красными были 4 случая vitest (`evidence.test.ts` — 1,
  `manual-checks.test.ts` — 2, contract test — 1: `expected [ false, true, false, false ] to deeply equal [ true, true,
  true, false ]` и подобные) и новый случай `ticket-evidence.test.sh` (`passed 86, failed 1`). После правки — зелёные:
  `ticket-evidence.test.sh` — `passed 87, failed 0`, exit 0.
- Новый fixture-Ticket `harness/bin/tests/fixtures/evidence/ru/03-manual-marks.md`. Contract test читает все
  fixture-Ticket-ы обеими копиями ещё и с меткой `вручную`.
- Изменение поведения: метка Profile-а больше не вытесняет `manual`. Profile с собственной меткой (например `à la main`)
  теперь читает и `(manual)`. Прежний test `manual-checks.test.ts` утверждал обратное — исправлен по правилу Ticket-а
  (п. 1–2 «Что делаем»). Решено без владельца, подтвердить.
- Пункт 2 Ticket-а `worfy-mcp-live` 08 до merge: `parseDoneSection` из Harness Mac Stable с `manualMark: 'вручную'` —
  `2 manual: false`; из ветки — `2 manual: true`. Проверка `ticket evidence worfy-mcp-live 08` на main — после merge.
- Matrix `ticket evidence` не печатает признак `manual`: разница видна в причине, когда под пунктом стоит строка
  `test-run` (`manual item needs owner-check, screenshot or video`).
- `docs/features/evidence.md:46-47` тоже описывает метки (метка Profile-а и старая русская) — не правлен: файл соседа
  по Wave (worfy-acceptance 04).
