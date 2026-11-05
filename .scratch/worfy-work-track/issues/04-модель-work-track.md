# 04 — Модель Work track: Span-ы, дорожки, сводка, пробелы

Type: task
Status: open
Blocked by:
Source: [spec.md](../spec.md), «Как работает» → «Модель»; «Решения владельца», 2, 9, 10; [05](../../worfy-autopilot-queue/issues/05-вид-work-track.md), Q3, Q4, Q6

## Что происходит

- Модель Run history — один Run: факты (`src/shared/flight-recorder/facts.ts`, виды Span-ов `:9`, причины Wait `:29`,
  источники `:33`, причины потерь вроде `transcript-deleted` `:38`), Span-ы (`spans.ts`), сводка (`summary.ts`).
- Для ленты нескольких Session за период модели нет: дорожки по Session и Epic-у, свёрнутые Subagent-ы, часы без
  двойного счёта, пробелы по источнику.

## Что делаем

Чистые модули `src/shared/work-track/`, без Node и DOM:

1. `facts.ts` — контракт фактов reader-ов: `WorkFact` (`kind`: `run` | `wave` | `turn` | `subagent` | `pr` | `ci` |
   `gate` | `ticket-status`; `start`, `end`, `outcome`, `session`, `parent?`, `epic?`, `ticket?`, `pr?`, `source`,
   `title`), `SessionInfo` (`id`, `name`, `vendor`, `hidden`, `archived`), `SourceGap` (`source`, `start`, `end`,
   `why`), `Period` (`day` | `week` | `month`, начало).
2. `lanes.ts` — дорожки «by Session»: «Autopilot Runs» сверху (Run и Wave), затем Session по времени первой работы,
   Subagent-ы — дети Session (свёрнуты, развёртка — по флагу), «Gate runs»; «by Epic» — дорожка на Epic, «—» для
   неопределённых; Span-ы обрезаются по периоду.
3. `summary.ts` — часы: объединение интервалов работы (ходы, Subagent-ы, Wave-ы) без двойного счёта; часы по Epic-ам —
   объединение внутри Epic-а; PR merged, Run-ы, число пробелов; Month — часы и merged по дням.

## Готово, когда

- [ ] Unit test дорожек: три Session, Run с двумя Wave-ами, Subagent-ы внутри и снаружи Wave, run-ы gate — порядок
      дорожек, свёрнутые дети, «by Epic» с «—».
- [ ] Unit test сводки: два параллельных Subagent-а по часу — 1 h, не 2; Span через полночь в Month — делится по
      дням; пробел считается один раз на источник.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Unit `test/unit/work-track-lanes.test.ts`, `test/unit/work-track-summary.test.ts` (новые). Сначала падающий — модулей нет.

## Где в коде

- `src/shared/work-track/facts.ts`, `src/shared/work-track/lanes.ts`, `src/shared/work-track/summary.ts` (новые)
- `test/unit/work-track-lanes.test.ts`, `test/unit/work-track-summary.test.ts` (новые)

Только читать: `src/shared/flight-recorder/facts.ts`, `src/shared/flight-recorder/spans.ts`, `src/shared/flight-recorder/summary.ts`.
