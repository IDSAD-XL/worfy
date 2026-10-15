# 04 — Отчёт о критическом пути Ticket-ов: claim → PR → CI → Gate → merge по уже записанным событиям

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), решение владельца 2026-10-15, пункт 1 (идея F); исследование
[PR #325](https://github.com/IDSAD-XL/worfy/pull/325), раздел «F. P2: measure the critical path
instead of accelerating individual agents»; [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md);
[ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md).

## Что происходит

- Сколько Ticket ждёт на каждом шаге — неизвестно: никто не считал. Решения «что ускорять» сейчас —
  догадка.
- **События уже записаны, нового хранилища не нужно** (ADR-0002):
  - журнал прогона Autopilot — `<папка данных worfy>/autopilot/<run>.jsonl`, на Mac
    `~/Library/Application Support/worfy/autopilot/` (`src/main/autopilot/journal.ts:1`). У каждой
    строки есть `at` (`:71`). Формат и виды событий — шапка `src/shared/autopilot/journal.ts`,
    список видов — `JOURNAL_EVENT_KINDS` (`:146-163`): `wave-started`, `wave-finished`,
    `narrow-round`, `limits-hit`, `waiting-until`, `resumed`, `session-error`, `run-stopped` и
    другие; пишет их `src/main/autopilot/run.ts`. Строку не-JSON или неизвестного вида читатель
    пропускает и считает (`journal.ts:138-140`);
  - Status Ticket-а — `claimed — <дата>` при claim (`bin/ticket` Harness) и `done — <дата>, [PR #N]`
    при закрытии; разделы «Итог» — круги ревью и Gate;
  - git — коммиты веток `<эпик>/<NN>` и мерж в main;
  - PR — `gh pr view <N> --json createdAt,mergedAt,statusCheckRollup,comments`: открытие, CI,
    комментарии Gate (`VERIFIED`, `REJECTED`, `NARROW: …`), мерж.

## Что делаем

1. **Скрипт `scripts/critical-path.mjs`** (Node, без зависимостей сверх уже имеющихся). Вход:
   папка журналов (по умолчанию — папка данных worfy), корень Project-а, Epic или список Ticket-ов.
   Данные PR — через `gh` или из файла JSON (`--prs <файл>`), чтобы test-ы шли без сети.
2. **Для каждого Ticket-а** — моменты и длительности шагов: claimed (или `wave-started` с этим
   Ticket-ом) → PR открыт → CI зелёный → Gate (`VERIFIED`) → merge. Отдельно: время ожидания Limits
   (`limits-hit` / `waiting-until` → `resumed`), число кругов доработки (`REJECTED` в PR, события
   `narrow-round`), остановки прогона (`session-error`, `run-stopped`). Шаг, о котором данных нет, —
   пустая ячейка с причиной, а не ноль.
3. **Сводка по Epic-у или Wave:** какой шаг дольше всего в сумме и в медиане — это и есть ответ.
4. **Вывод** — Markdown (по умолчанию) или CSV (`--csv`), в stdout или в путь из `--out`. Скрипт
   только читает: в репозитории Project-ов, `~/.claude` и папку данных worfy он не пишет (ADR-0005).
5. В отчёт не идут тексты транскриптов, токены и личные пути: только номера Ticket-ов, PR, время.

## Готово, когда

- [ ] `node scripts/critical-path.mjs --help` печатает вход и выход; без аргументов — отчёт по
      журналам папки данных, exit 0.
- [ ] На fixture-журнале и fixture PR unit test-ы проверяют длительности каждого шага, ожидание
      Limits, круги доработки и пустую ячейку при нехватке данных.
- [ ] Битая строка и строка неизвестного вида в журнале пропускаются и считаются, отчёт строится.
- [ ] Test проверяет, что скрипт ничего не пишет вне `--out` (временная папка, список файлов до и после).
- [ ] (вручную) Отчёт по настоящим журналам Mac владельца для одного закрытого Epic-а — в «Итог»,
      без личных путей; какой шаг вышел критическим.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] зелено (full)`; Linux CI зелёный.

## Тесты

- `test/unit/critical-path.test.ts` — запуск скрипта через `spawnSync`, как
  `test/unit/check-handoff.test.ts`; fixture — `test/fixtures/critical-path/` (журнал JSONL, PR JSON,
  Ticket-ы с Status).
- Сначала красный: test на длительность шага «PR → merge» по fixture до появления скрипта.
- Мутанты: перепутать `at` двух событий; считать пустую ячейку нулём; писать файл рядом с журналом.
  Каждый краснит свой test; итог — в «Итог».

## Где в коде

- `scripts/critical-path.mjs`
- `test/unit/critical-path.test.ts`
- `test/fixtures/critical-path/`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`src/shared/autopilot/journal.ts`, `src/main/autopilot/journal.ts`, `src/main/autopilot/run.ts`,
`test/unit/check-handoff.test.ts`.

## Вне скоупа

- Вид в окне worfy (UI) — только отчёт скрипта.
- Новое хранилище событий и новые поля журнала (ADR-0002).
- Время внутри шага исполнителя по транскриптам.

## Риски

- **Старые журналы беднее:** часть видов событий появилась позже (`narrow-round`, `harness-behind`).
  Ячейка без данных — пустая с причиной.
- **Дата claim — без времени** (`claimed — <дата>`): точный момент — `wave-started`, без Autopilot —
  первый коммит ветки.

## Итог

—
