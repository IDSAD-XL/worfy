# 01 — Строка Evidence и команда `ticket evidence`

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Модель» («Строка Evidence», «Состояние пункта»), «Решено без владельца», п. 1–3, 7, «Вопросы владельцу», Q1; случай worfy-windows 16 (`.scratch/worfy-windows/issues/16-приёмка-worfy-windows.md:184`)

## Что происходит

- `harness/bin/ticket` — единственный писатель строк шапки (`harness/bin/ticket:2-8`), команды —
  `done|claim|open|block|show|migrate|root|mark` (`harness/bin/ticket:130`). Раздел «Готово, когда» он не читает.
- Чем доказан пункт и где проверен, видно только из «Итог». Пункт 2 worfy-windows 16 проверили в установленной копии
  вместо Stable copy — поймал человек.
- Заголовок раздела у Project-а свой: `tickets.done_section` Profile-а (по умолчанию `## Done when`, у worfy —
  `## Готово, когда`), ручная пометка — `tickets.manual_mark`. С `--root` (так `ticket` зовёт `land`) Profile не читается
  (`harness/bin/ticket:220`), и заголовок упал бы на `## Done when`. worfy на этот случай читает и старые русские заголовки
  (`OLD_DOC_HEADINGS`, `src/shared/workflow/doc-headings.ts:23-31`).

## Что делаем

1. **`harness/lib/evidence.cjs`** (CommonJS, как `harness/lib/pipeline.cjs`) — чистые функции без fs:
   `parseDoneSection(markdown, { doneSection, manualMark })` → пункты по порядку `{ index, text, checked, manual, needs,
   evidence: [{ kind, verdict, ref, platform, copy, sha, scrub, line }], errors }`; `itemState(item)` → `verified` |
   `not-verified` (с `reason`) | `failed`; `formatEvidence(fields)` → строка. Грамматика и правила состояния — spec,
   «Модель»: исход только `pass`/`fail` (у `review` тоже), `platform` и `copy` `-` — у `commit` и `review`, номер — у каждого
   checkbox-пункта на любой глубине по порядку файла, строка Evidence относится к ближайшему пункту над ней. Code fence
   пропускается по `harness/lib/code-fence.cjs`.
   **Заголовки:** значения Profile-а (`tickets.done_section`, `tickets.manual_mark`; без Profile-а — `## Done when`, `manual`) и
   всегда, как `OLD_DOC_HEADINGS` в worfy, старые `## Готово, когда` и `вручную` — с пометкой
   `// shortcut: accepts the old Russian token, remove after the next release (worfy-neutral 08)`: без неё `check-cyrillic`
   не пропустит кириллицу в коде Harness (ADR-0074).
2. **`ticket evidence <epic> <NN>`** — печатает матрицу: `<n>. <state> <reason?> — <text>` и строки под ним; последняя
   строка — `evidence: N of M verified`. Exit 0.
3. **`ticket evidence <epic> <NN> <item> <kind> <pass|fail> --ref "<text>" [--platform P] [--copy C] [--sha S] [--scrub YYYY-MM-DD] [-n]`**
   — вставляет строку `  - evidence: …` после последней строки пункта `<item>` (номер checkbox-пункта раздела, с 1).
   По умолчанию `--platform` — из `process.platform` (`darwin` → `mac`, `win32` → `windows`, `linux` → `linux`; при
   `GITHUB_ACTIONS=true` — `ci`), `--sha` — `git rev-parse HEAD`, `--copy` — `-`; у `commit` и `review` платформа и копия всегда `-`; у `screenshot` и
   `owner-check` `--copy` обязателен. Неизвестный вид, исход, платформа, копия, `ref` с ` · ` или переводом строки, SHA не из 7–40 hex, номер пункта
   вне раздела — exit 2 с текстом. `-n` печатает строку и не пишет. Запись — тем же `readTicket`/`writeTicket` (BOM, концы
   строк сохраняются; символическая ссылка — в её цель).
4. **`ticket done`** (Ответ Q1): после записи печатает в stderr `evidence: N of M verified` и по строке на каждый
   непроверенный или красный пункт; exit code не меняется. Ticket без раздела — ни строки.
5. **`harness/bin/TICKETS.md`** — термин **Evidence** и грамматика строки рядом с «Header»; usage `ticket`.

Не входит: privacy check (02, 03), worfy (05).

## Готово, когда

- [ ] Shell test: Ticket с пунктами без Evidence — `ticket evidence` печатает «0 of 3 verified» и причину `no evidence`.
- [ ] Shell test: запись `test-run pass` в пункт 2 вставляет строку после продолжения пункта, остальной файл байт в байт тот
      же (BOM и CRLF — отдельные случаи); повторная запись встаёт после первой строки Evidence.
- [ ] Shell test: правила состояния — последняя строка `fail` даёт `failed`; только `review pass` — `not-verified review only`;
      `needs: windows stable` и `screenshot pass … windows installed` — `not-verified needs windows stable, got windows installed`;
      ручной пункт с одним `test-run pass` — `not-verified`; с `owner-check pass` — `verified`.
- [ ] Shell test: каждый отказ из п. 3 — exit 2 и файл не тронут; `-n` файл не трогает.
- [ ] Shell test: `ticket done` на Ticket-е с непроверенным пунктом пишет предупреждение в stderr, exit 0, `Status: done` записан.
- [ ] Shell test: заголовок раздела из Profile-а (`## Done when` у английского fixture-проекта); старый `## Готово, когда` читается
      и с `--root` без Profile-а; `node scripts/check-cyrillic.mjs` — exit 0 на `evidence.cjs`.
- [ ] Shell test: вложенный checkbox-пункт получает свой номер по порядку файла; строка Evidence под ним — его, а не родителя.
- [ ] Shell test: `review` с исходом `VERIFIED` — exit 2 (только `pass`/`fail`); `review pass` с `-` `-` записан.
- [ ] Строки внутри code fence не читаются.
- [ ] `bash harness/bin/tests/ticket-evidence.test.sh`, `ticket-header.test.sh`, `ticket-mark.test.sh`, `tickets-root.test.sh` —
      exit 0; CI PR зелёный, Windows verdict до merge (platform PR).

## Тесты

- Shell `harness/bin/tests/ticket-evidence.test.sh` (новый), fixture-Ticket-ы в `harness/bin/tests/fixtures/evidence/`.
- Сначала падающий: `ticket evidence demo 01` — сейчас exit 1 с usage.
- Прогнать все `harness/bin/tests/ticket-*.test.sh` и `tickets-root.test.sh`.

## Где в коде

- `harness/lib/evidence.cjs` (новый)
- `harness/bin/ticket`
- `harness/bin/TICKETS.md`
- `harness/bin/tests/ticket-evidence.test.sh` (новый)
- `harness/bin/tests/fixtures/evidence/` (новая)

Только читать: `harness/lib/code-fence.cjs`, `harness/lib/pipeline.cjs` (образец модуля), `src/shared/workflow/manual-checks.ts`
(правило пунктов и продолжений).
