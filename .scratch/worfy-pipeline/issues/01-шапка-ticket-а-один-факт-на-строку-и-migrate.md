# 01 — Шапка Ticket-а: один факт на строку, `bin/ticket migrate`

Type: task
Status: open
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

- [ ] `bash harness/bin/tests/ticket-header.test.sh` — exit 0: `claim`, `open`, `done --pr`, `block --waits`
      пишут формат пункта 1; `migrate` переносит фикстуры всех спеллингов (`**Status:**`, подвал,
      `in-progress`, `заблокирован`, ссылка на PR, причина с `;`) и отказывается на непонятной строке.
- [ ] Тот же test: `epic-status --json` на перенесённой фикстуре — `state` каждого Ticket-а тот же,
      что до миграции; `blockedReason`, `waits`, `pr` заполнены.
- [ ] `bash harness/bin/tests/tickets-root.test.sh` и `bash harness/bin/tests/silent-mode.test.sh` —
      exit 0 (`migrate` в Silent mode пишет в Workflow folder).
- [ ] `pnpm test test/unit/epic-layout.test.ts test/unit/critical-path.test.ts` и
      `pnpm test test/contract/workflow-reader.test.ts` — exit 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.
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

## Итог

Заполняется при закрытии.
