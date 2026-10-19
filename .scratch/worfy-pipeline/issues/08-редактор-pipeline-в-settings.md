# 08 — Редактор Pipeline Project-а в Settings

Type: task
Status: open
Blocked by: 03, 06
Source: решение владельца 2026-10-17, grilling о Pipeline, пункт 10 ([spec.md](../spec.md), «Решения
владельца»: сначала Pipeline правится в `profile.json` руками или через `bin/profile`, редактор в
Settings — поздний Ticket); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md);
решение владельца 2026-10-19, Q-f — вариант (b): поле пишет отдельный скрипт Harness `bin/profile-set`
([ADR-0073](../../../docs/adr/0073-profile-set-writes-the-pipeline.md)); Q10 — делает Session на Mac после
мержа #517, #496 и #508.

## Что происходит

- Pipeline — поле `workflow.pipeline` в `profile.json` Profile-а, вне репозитория
  (`~/.claude/worfy-harness/projects/<name>/`). Проверяет его `bin/profile` (Ticket 02); `bin/profile`
  только читает (`harness/bin/profile:25`).
- Settings worfy — разделы `src/renderer/settings/*Section.tsx`, список — `src/renderer/settings/sections.ts`.
- worfy меняет workflow только инструментами Harness (ADR-0002). Так же пишет Profile `bin/project-connect`:
  проверка по схеме, запись, commit в git папки Harness (`harness/bin/project-connect:443-467`); worfy зовёт его
  из main (`src/main/projects/connect.ts`).
- **Платформенный PR** (ADR-0073): Ticket добавляет скрипт Harness (ADR-0056, пункт 2). Вердикт Windows — полный
  run на Windows-runner-е, если PR не трогает Terminal, окна, e2e и упаковку (ADR-0071, пункт 3); до мержа
  `worfy-windows` 66 — gate full на ПК. После мержа — `pnpm install:stable` (ADR-0047).

## Что делаем

1. Раздел Settings «Pipeline» для выбранного Project-а: виды из каталога ADR-0067 — включить,
   переставить, переименовать (`label`), задать `stuck_after`, `name` у Check и `environment` у
   Deploy. Своих видов и выражений нет.
2. **`harness/bin/profile-set`** (новый, Node, ADR-0055): пишет только `workflow.pipeline` в `profile.json`
   Profile-а одного Project-а и делает commit в git папки Harness, как `bin/project-connect`. Остальные поля
   не трогает. `bin/profile` остаётся только читающим (`harness/bin/profile:25`).
3. Перед записью — те же правила, что у `bin/profile` (`pipelineOf`, `harness/bin/profile:374`), общим кодом,
   а не копией. Неверный Pipeline не пишется: exit 1 с причиной, причина показывается в разделе.
4. Запись из worfy — через IPC main process (канал, обработчик, preload, общие типы); renderer файл не пишет.

## Готово, когда

- [x] Решение владельца об инструменте записи — Q-f (b), [ADR-0073](../../../docs/adr/0073-profile-set-writes-the-pipeline.md).
- [ ] Test `bin/profile-set` во временной `HARNESS_HOME`: верный Pipeline записан и закоммичен, прочие поля
      `profile.json` не изменились; неверный — exit 1, файл и история git прежние. Красный до скрипта.
- [ ] `pnpm test test/unit/settings-pipeline.test.tsx` — exit 0: включение, порядок, переименование;
      неверный Pipeline не записывается, причина видна.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.

## Тесты

Сначала падающие test `bin/profile-set` и `test/unit/settings-pipeline.test.tsx`; раздел Settings пишет
через stub `bin/profile-set` во временной папке `HARNESS_HOME`.

## Где в коде

- `src/renderer/settings/PipelineSection.tsx` (новый)
- `src/renderer/settings/sections.ts`
- `test/unit/settings-pipeline.test.tsx` (новый)
- `harness/bin/profile-set` (новый); общий код правил Pipeline с `harness/bin/profile`
- `harness/bin/tests/profile-set.test.sh` (новый; `test/contract/harness-scripts.test.ts:26-27` берёт все `*.test.sh` сам)
- `src/main/ipc/pipeline.ts` (или новый файл IPC) — обработчик записи
- `src/preload/index.ts`
- `src/shared/ipc/pipeline.ts` — канал и типы

## Итог

Решение владельца 2026-10-19 (Q-f): вариант (b) — отдельный скрипт `bin/profile-set`,
[ADR-0073](../../../docs/adr/0073-profile-set-writes-the-pipeline.md). Остальное заполняется при закрытии.
