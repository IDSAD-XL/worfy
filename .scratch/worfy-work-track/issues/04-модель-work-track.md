# 04 — Модель Work track: Span-ы, дорожки, сводка, пробелы

Type: task
Status: open
Blocked by: —
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
  - evidence: test-run pass · `pnpm test -- test/unit/work-track-lanes.test.ts` exit 0 · mac - · 4e57409f70ab7f59ba9b3e2ca9217f8a81a64b43
- [ ] Unit test сводки: два параллельных Subagent-а по часу — 1 h, не 2; Span через полночь в Month — делится по
      дням; пробел считается один раз на источник.
  - evidence: test-run pass · `pnpm test -- test/unit/work-track-summary.test.ts` exit 0 · mac - · 4e57409f70ab7f59ba9b3e2ca9217f8a81a64b43
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 4e57409f70ab7f59ba9b3e2ca9217f8a81a64b43
  - evidence: gate pass · `gate fast` exit 0 · mac - · 4e57409f70ab7f59ba9b3e2ca9217f8a81a64b43

## Тесты

- Unit `test/unit/work-track-lanes.test.ts`, `test/unit/work-track-summary.test.ts` (новые). Сначала падающий — модулей нет.

## Где в коде

- `src/shared/work-track/facts.ts`, `src/shared/work-track/lanes.ts`, `src/shared/work-track/summary.ts` (новые)
- `test/unit/work-track-lanes.test.ts`, `test/unit/work-track-summary.test.ts` (новые)

Только читать: `src/shared/flight-recorder/facts.ts`, `src/shared/flight-recorder/spans.ts`, `src/shared/flight-recorder/summary.ts`.

## Итог

- Модель — три чистых модуля `src/shared/work-track/` без Node и DOM: `facts.ts` (контракт reader-ов: `WorkFact` с `id`
  для ссылки `parent`, `SessionInfo`, `SourceGap`, `Period`, `WorkTrackInput`, имена источников для строки «Source: …»),
  `lanes.ts` (Span-ы, обрезанные по периоду; дорожки «by Session» и «by Epic»), `summary.ts` (сводка периода и дни).
- Сначала падающий test: оба test-а красные на `92af934c3` — модулей `src/shared/work-track/*` нет (vitest: «Failed to
  load url»); после реализации 15 test-ов зелёные, и в часовых поясах America/New_York, Asia/Kolkata, Pacific/Auckland,
  UTC тоже (время в fixture-ах — локальное).
- Объединение интервалов — `intervalUnionLength` из `src/shared/flight-recorder/summary.ts`, без копии.

Решено без владельца (для 05–10):

1. **Epic по цепочке `parent`.** Факт без `epic` берёт Epic родителя: Wave — своего Run-а, Subagent внутри Wave — Wave-ы,
   Subagent, запущенный Subagent-ом, — его. Нет нигде — «—», без угадывания (риск 3 spec-а).
2. **Wave, запущенная руками, — тоже на дорожке «Autopilot Runs»**: маркер Wave один для обоих случаев, а другой
   дорожки с рамками Wave нет.
3. **PR, CI и смены статуса Ticket-ов — ни на одной дорожке** (`offLaneSpans`): прототип ставит ромбы PR на ось, для CI
   дорожки в решениях владельца нет; место выбирают 09 и 10.
4. **Дорожки Subagent-ов** — одна на имя (`title`) под тем же родителем, вложены под Subagent-а, который их запустил,
   как в прототипе; свёрнутая Session несёт число дорожек и полосу (`strip`) из Span-ов Subagent-ов.
5. **«by Epic»** — Epic-и по часам (объединение) от большего, «—» последней; на дорожках Epic-а — Wave-ы, ходы и
   Subagent-ы (Run — нет, как в прототипе), внизу «Gate runs».
6. **Пробел** считается один раз на источник: пересекающиеся и смежные пробелы одного источника — один (пробел
   транскрипта одной Session внутри пробела всех — один). `SourceGap.session` (необязательное поле) — пробел одной
   Session; такая Session получает дорожку, даже если работы в периоде нет. Пробелы транскриптов штрихуют дорожки
   Session на Claude Code, пробелы Codex — на Codex, gate — «Gate runs», журналы и маркеры Wave — «Autopilot Runs».
7. **Период**: Day — сутки, Week — 7 суток, Month — календарный месяц от `start` (экран начинает его с 1-го); дни — по
   локальной полуночи, через смену летнего времени. Факт без конца длится до `now`. PR merged — факт `pr` с `end`
   (время merge) внутри периода; Run — пересекающий период.
8. Часы по Epic-ам — объединение внутри Epic-а, поэтому час, общий двум Epic-ам, есть в обоих, и сумма может быть
   больше «of work in total».
