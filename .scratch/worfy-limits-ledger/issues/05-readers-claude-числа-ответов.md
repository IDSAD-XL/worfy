# 05: Readers Claude: числа ответов без текста

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Ticket-ы», 05; «Решения по реализации» («Readers оставляют числа и отметки, текст —
нет», «Транскрипты других папок — только числа», «Хранение и приватность»); «Решения по test-ам», Seam 2; «Риски»
(«Чтение транскриптов дорого», «Формат транскрипта меняется»); «Вопросы владельцу», Q7; «Волны», Wave 2

Кто: агент. Глубина ревью — `high`: Ticket трогает правило «Только названия» (решение владельца,
`.scratch/worfy-work-track/spec.md:62`); reviewer проверяет, что ни одна строка текста хода не доходит до записей.

Платформенный PR (ADR-0056, пункт 2): проход по папкам транскриптов `~/.claude/projects` всех Project-ов — пути ОС;
до merge нужен Windows verdict.

## Что происходит

- Reader Work track оставляет от ответа `kept.message = { role, content }` (`src/main/work-track/transcripts.ts:195`,
  `NamesOnly.record`, `:157-200`), reader Flight Recorder — то же (`src/main/flight-recorder/transcripts.ts:196`, поля
  `KEPT_FIELDS`, `:128`, `:165`). `message.id`, `message.model` и `message.usage` отбрасываются.
- Отказ Limits в транскрипте — ответ `<synthetic>` с текстом отказа (fixture
  `test/fixtures/agent-scripts/autopilot-limits-weekly.jsonl`); `isLimitsMessage` узнаёт текст
  (`src/shared/autopilot/resume-at.ts:155`).
- Readers читают только папки этого Project-а; транскриптов других папок worfy не читает.

## Что строить

- Оба reader-а оставляют от `message` ещё `id`, `model` и числовые поля `usage` (включая `cache_creation` 5m и 1h и
  `speed`). Текст по-прежнему не проходит.
- Reader ставит отметки `UsageRecord` сам и отбрасывает то, по чему их узнал:
  - `compacted` — перед ответом строка `isCompactSummary`;
  - `limitsRefused` — ответ `<synthetic>`, чей текст `isLimitsMessage`; сам текст дальше не идёт, как вердикт у
    `verdictOf` (`src/main/work-track/transcripts.ts:127`).
- Reader отдаёт список `UsageRecord` рядом с фактами, не внутри них. `TranscriptCache`
  (`src/main/work-track/transcripts.ts:261`) держит и этот список.
- Проход по другим папкам `~/.claude/projects` (решение владельца 2026-11-28, Q7 (а)): только строки ответов, только время, модель, Session и счётчики;
  файлы, изменённые до начала окна или периода, пропускаются по времени изменения. Имя папки и `cwd` из него не выходят.
- Ответ без полей `usage` — в «Not counted», не ноль.

## Где в коде

- `src/main/work-track/transcripts.ts` — `NamesOnly`, `TranscriptCache`
- `src/main/flight-recorder/transcripts.ts` — `KEPT_FIELDS`, фильтр `message`
- `src/main/usage/other-projects.ts` (новый, имя — предложение) — проход по чужим папкам
- Путь `~/.claude/projects` — тот же, что у reader-ов: `claudeHome` (`src/main/storage/paths.ts:50`; `src/main/flight-recorder/transcripts.ts:413`,
  `src/main/work-track/transcripts.ts:471`), не новый
- `test/contract/work-track-transcripts.test.ts`, `test/contract/flight-recorder-transcripts.test.ts`
- `test/fixtures/` — fixture-транскрипты с `usage`, `<synthetic>`-отказом и compact summary, без домашних путей

## Test-ы

- Contract test-ы обоих reader-ов: числа `usage`, `id`, `model` и обе отметки доходят до `UsageRecord`; текст ходов,
  текст отказа и `cwd` чужих папок — нет (test ищет известную строку текста fixture-а в выходе и не находит её).
- Contract test прохода по чужим папкам: только числа, файл старше начала окна пропущен.
- Contract test-ы readers идут и на Windows runner-е (пути транскриптов).
- Сначала падающий test: красный на старом reader-е, это пишется в «Итог».
- Без моделей и без сети.

## Готово, когда

- [ ] Readers Work track и Flight Recorder отдают `UsageRecord` с `id`, `model`, числами `usage` и отметками
      `compacted` и `limitsRefused`; текст ходов не проходит (contract test-ы).
- [ ] Проход по другим папкам отдаёт только числа, время, модель и Session; имён папок нет (contract test).
- [ ] Contract test-ы readers зелёные на Windows runner-е.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR; Windows verdict — в «Итог».
