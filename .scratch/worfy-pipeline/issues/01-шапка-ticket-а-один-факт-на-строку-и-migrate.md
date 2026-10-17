# 01 — Шапка Ticket-а: один факт на строку, `bin/ticket migrate`

Type: task
Status: claimed 2026-10-17
Branch: worfy-pipeline/01
Blocked by: —
Source: решение владельца 2026-10-17, grilling о Pipeline, пункты 3, 6 ([spec.md](../spec.md), «Решения
владельца»); [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md),
[ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md).

## Что происходит

- **Строка `Status:` несёт несколько фактов.** `bin/ticket` пишет `done — 2026-10-16, [PR #N](…)`,
  `claimed — 2026-10-16`, `blocked — <причина>` (`harness/bin/ticket:5-11`, `:250-252`). Причина
  блокировки — хвост той же строки, иногда с «Autopilot не берёт» и ссылкой на spec.
- **Спеллинг поля не навязан:** `bin/ticket` сохраняет и `**Status:**`, и `Status:`
  (`harness/bin/ticket:26-28`, `:204-209`).
- **`epic-status` берёт последнюю строку `Status:` во всём файле** — шапка или подвал
  (`harness/bin/epic-status:19-20`) — и классифицирует слово, включая `in-progress`,
  `ready-for-agent`, `заблокирован` (`:93-111`).
- **worfy режет причину из сырой строки** (`blockedReason`, `src/renderer/canvas/epic-layout.ts:477-485`;
  вызов — `src/renderer/canvas/nodes/TicketNode.tsx:111`). Поле `statusRaw` в модели —
  `src/shared/workflow/types.ts:24`.
- **`scripts/critical-path.mjs:284`** берёт дату и номер PR регулярным выражением из той же строки.
- Строк «кого ждёт» нет нигде: это знает только текст причины.
- В репозитории worfy 297 файлов Ticket-ов (`.scratch/*/issues/*.md`).

## Что делаем

1. **Формат шапки** (`harness/bin/TICKETS.md` — описание; одна строка — один факт, без жирного):
   - `Status: <open|claimed|blocked|done> <время>` — время ISO 8601 UTC до минут
     (`2026-10-17T09:41Z`); у перенесённых — дата `2026-10-16` (читается как 00:00 UTC). У `open`
     время необязательно.
   - `Blocked reason: <текст>` — только при `blocked`.
   - `Waits: owner | team | agent | <имя Machine>` — пишет `block --waits`; снимают `claim`, `open`,
     `done`.
   - `PR: #<N>` — пишет `done --pr N` (Full mode).
   - `Branch:`, `Repo:`, `Type:`, `Blocked by:`, `Source:` — как сейчас.
2. **`bin/ticket` пишет только новый формат:** `claim`, `open`, `done [--pr N]`,
   `block <reason> [--waits <who>]`. Старые спеллинги больше не сохраняются: команда на файле со
   старой шапкой — exit 1 «run ticket migrate first».
3. **`bin/ticket migrate [--epic <e>] [-n]`** — однократный перенос всех Ticket-ов корня Ticket-ов
   (`ticket root`; в Silent mode — Workflow folder). Для каждого файла:
   - берёт строку `Status:` шапки (первая в файле вне блока кода), раскладывает её на `Status:`,
     `Blocked reason:`, `PR:`; слово приводит к четырём (`in-progress` → `claimed`, `заблокирован`
     → `blocked`, как классифицирует `epic-status` сейчас);
   - строки `Status:` в подвале файла (старый двойной спеллинг) удаляет;
   - `Waits:` не угадывает; печатает список `blocked` Ticket-ов без `Waits:`;
   - строку, которую не понял, не трогает: exit 1 со списком файлов и строк; файл уже в новом
     формате пропускает;
   - `-n` — печатает diff и ничего не пишет.
4. **`epic-status` читает только новый формат:** первая строка `Status:` вне кода, четыре слова; в
   JSON — новые поля `statusAt`, `blockedReason`, `waits`, `pr`. Старая строка — `state: none` и
   причина `old header`, не догадка.
5. **worfy:** `types.ts` получает `statusAt`, `blockedReason`, `waits`, `pr`; Card берёт причину из
   `blockedReason`, `blockedReason()` в `epic-layout.ts` удаляется. `critical-path.mjs` читает
   `Status:` и `PR:` нового формата.
6. **Миграция worfy (шаг Orchestrator-а после мержа):** `bin/ticket migrate -n`, затем
   `bin/ticket migrate` и `ticket block --waits` для напечатанного списка, отдельным PR, между
   Wave-ами (нет открытых PR с файлами Ticket-ов). Для Atakama — так же, в её Workflow folder.

Не входит: Stage (Ticket 03), отметки (Ticket 02).

## Готово, когда

- [x] `bash harness/bin/tests/ticket-header.test.sh` — exit 0: `claim`, `open`, `done --pr`, `block --waits`
      пишут формат пункта 1; `migrate` переносит фикстуры всех спеллингов (`**Status:**`, подвал,
      `in-progress`, `заблокирован`, ссылка на PR, причина с `;`) и отказывается на непонятной строке.
- [x] Тот же test: `epic-status --json` на перенесённой фикстуре — `state` каждого Ticket-а тот же,
      что до миграции; `blockedReason`, `waits`, `pr` заполнены.
- [x] `bash harness/bin/tests/tickets-root.test.sh` и `bash harness/bin/tests/silent-mode.test.sh` —
      exit 0 (`migrate` в Silent mode пишет в Workflow folder).
- [x] `pnpm test test/unit/epic-layout.test.ts test/unit/critical-path.test.ts` и
      `pnpm test test/contract/workflow-reader.test.ts` — exit 0.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.
- [ ] Платформенный PR (ADR-0056, пункт 2): вердикт Windows — gate full на ПК, код 0 и
      `[gate] зелено (full)`.
- [ ] (вручную, Orchestrator после мержа) PR миграции worfy: `epic-status --json` до и после —
      расхождений `state` ноль; список `blocked` с `Waits:` — в «Итог».

## Тесты

Сначала падающий test: `ticket-header.test.sh` на фикстуре со старой шапкой ждёт новый формат после
`migrate`. Фикстуры — копии реальных строк из `.scratch/*/issues/` без путей пользователя. `gh` не
нужен.

## Где в коде

- `harness/bin/ticket`
- `harness/bin/epic-status`
- `harness/bin/TICKETS.md`
- `harness/bin/tests/ticket-header.test.sh` (новый)
- `src/shared/workflow/types.ts`
- `src/renderer/canvas/epic-layout.ts`
- `src/renderer/canvas/nodes/TicketNode.tsx`
- `scripts/critical-path.mjs`
- `test/unit/critical-path.test.ts`
- `test/unit/epic-layout.test.ts`
- `test/contract/workflow-reader.test.ts`
- `src/main/workflow/reader.ts` (добавлено при claim: переносит из ветки статус вместе с `blockedReason`, `waits`, `pr`)
- `test/fixtures/workflow-stub/epic-status.mjs`, `test/contract/scratch-gen.ts` (stub `epic-status` для contract test-ов — новый формат)
- `test/fixtures/critical-path/project/.scratch/demo-epic/issues/*.md` (фикстуры `critical-path` — перенесены `ticket migrate`)
- `test/unit/epic-canvas.test.tsx` (test причины на Card)
- `test/e2e/epic-frame.spec.ts` (добавлено в круге 2: его stub `epic-status` и фикстуры Ticket-ов — новый формат; остальные e2e отдают готовый ответ `epic-status`, и их результат от формата шапки не зависит)
- `harness/bin/tests/tickets-root.test.sh`, `harness/bin/tests/silent-mode.test.sh`, `harness/bin/tests/harness-home.test.sh` (ждали старую строку `Status:`; `migrate` в Silent mode)
- `harness/skills/ship-ticket/SKILL.md`, `harness/hooks/rules/orchestrator.md` (тексты о «спеллинге файла»)
- `harness/evals/lib/demo-project.sh`, `harness/evals/reviewer-intended-breakage/scaffold.sh`, `harness/evals/reviewer-simplification/scaffold.sh`, `test/contract/harness-evals.test.ts` (scaffold-ы eval-ов писали `claimed — дата`)

## Итог

Ветка `worfy-pipeline/01`. Что сделано:

- `harness/bin/ticket` пишет только новый формат: `Status: <слово> <время>` (UTC до минут, `open` тоже с
  временем), `Blocked reason:`, `Waits:`, `PR: #N` сразу под `Status:`. `claim`, `open`, `done` снимают
  `Blocked reason:` и `Waits:`; `PR:` остаётся, `done --pr` его заменяет. На файле со старой шапкой любая
  запись — exit 1 «run ticket migrate first». `ticket migrate [--epic E] [-n]` — как в пункте 3.
- `harness/bin/epic-status` читает только новый формат; в `--json` — `statusAt`, `statusError`,
  `blockedReason`, `waits`, `pr`; в строке `Этап` — «N with an old header — run ticket migrate».
- worfy: Card берёт причину из `blockedReason`; `blockedReason()` удалена; tooltip Card — `Status` и через
  « — » причина, как раньше одна строка `blocked — <причина>`. Reader переносит из ветки весь статус (ADR-0033
  не тронут: ветка по-прежнему не перекрывает `blocked` и `done` checkout-а). `critical-path.mjs` читает
  `Status:` и `PR:` шапки.

`ticket migrate -n` на настоящем `.scratch` (2026-10-17, дерево ветки; шапка этого Ticket-а уже перенесена
им же): 232 файла к переносу, 73 уже в новом формате, 0 без Status, 0 отказов. `blocked` без `Waits:` — 5:
worfy-link 16, worfy-terminal-ai 09, worfy-throughput 04 и 05, worfy-ui 12. Заметки, которые `migrate`
выбросит из строк `done` (в «Итог» этих Ticket-ов то же самое): worfy-reliability 02 и 03 — «отчёт — [PR #…]»
и «решение владельца — в «Итог»». На копии дерева: `epic-status --json` до (версия с main) и после
`migrate` — `state` всех 305 Ticket-ов совпал, `statusError` — 0, `pr` — у 224, причина всех 5 `blocked`
совпала с текстом, который Card показывала раньше.

Решено без владельца, подтвердить:

- Читатель принимает `Status: <слово>` без времени для всех четырёх слов (`statusAt: null`), не только для
  `open`: так `Status: done` из шаблонов и test-ов не становится `none`. Пишет `ticket` всегда со временем.
- Вторая строка `Status:` в файле (старый подвал) — тоже старая шапка, и для `epic-status`, и для `ticket`.
- `migrate` — всё или ничего: при любом отказе не пишет ни одного файла. Подвал с другим словом, чем шапка, —
  отказ (старый читатель брал последнюю строку, и выбор шапки сменил бы `state`).
- Заметка в строке `done` выбрасывается и печатается («note dropped: …»); заметка в `claimed` или `open` —
  отказ.
- `ticket block <epic> <NN> --waits <кто>` без причины на уже `blocked` Ticket-е ставит только `Waits:`,
  причину и время не трогает — это шаг 6 после `migrate`. `block` с новой причиной без `--waits` снимает
  старый `Waits:`.
- `epic-status --json` отдаёт и `statusError` (причину `state: none`), кроме четырёх полей из пункта 4.
- `PR:` пишется без ссылки (`PR: #412`), как в пункте 1; ссылка на GitHub из строки Status уходит.

Не проверено: вердикт Windows (gate full на ПК) — шаг оркестратора; миграция worfy (пункт 6) — шаг
оркестратора после merge.
