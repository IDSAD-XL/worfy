# 05 — Проверка Limits для Assistant-а, дневной предел пробуждений и мониторинг расхода

Type: task
Status: claimed 2026-11-25T08:12Z
Blocked by: —
Source: [spec.md](../spec.md), «Ticket-ы», строка 05; «Решения владельца», 13 и 20; «Решения по реализации» → «Ядро
внимания (main)», «Решение о пробуждении»; «Мониторинг расхода (решение владельца)»; «Риски»; истории 34 и 35;
«Волны», Wave 1

Кто: агент.

## Что строить

1. **Проверка Limits для Assistant-а** — обобщённая проверка Limits у Terminal AI, порог 5-часового окна 80 %.
2. **Дневной предел автоматических пробуждений.**
3. **Мониторинг расхода — данные** (экран — Ticket-ы 14 и 15):
   - token-ы считаются по каждому вызову: и Session-ов Assistant-а, и проверок источников;
   - разбивка — по источникам, по пробуждениям и по разговору; срок — за день и за неделю;
   - доля Assistant-а в окнах Limits — оценка: доли отдельного вызова worfy не знает, он видит только общий процент окна.
     Способ оценки выбирает этот Ticket.

Применяет проверку и предел перед пробуждением Ticket 06.

## Где в коде

- Проверка Limits у Terminal AI — `src/main/terminal-ai/limits-gate.ts`, test `test/unit/terminal-ai-limits-gate.test.ts`.
- Limits в main — `src/main/agent/limits.ts`, `src/main/agent/limits-usage.ts`.

## Решения

- Перед пробуждением — проверка Limits и дневной предел (решение 13; spec, «Решение о пробуждении»).
- Порог 5-часового окна — 80 %; несрочное ждёт, пока окно занято больше (история 34).
- Мониторинг: сколько token-ов и какую долю Limits потратил Assistant (решение 20); процент — оценка, способ выбирает
  Ticket (spec, «Мониторинг расхода»).

## Test-ы

Стык А (spec, «Решения по test-ам»): на входе — Limits, часы и настройки; на выходе — можно ли будить. Образец —
`test/unit/terminal-ai-limits-gate.test.ts`. Часы ненастоящие.

## Готово, когда

- [ ] Unit test: при занятом больше чем на 80 % 5-часовом окне проверка не пускает несрочное пробуждение; при 80 % и ниже
      — пускает.
  - evidence: test-run pass · `pnpm test test/unit/assistant-wake-gate.test.ts` exit 0 · mac - · 2fa4a5519c5c61eaf7880667b4bc5c1d5fb8fbad
- [ ] Unit test: дневной предел автоматических пробуждений — пробуждение сверх предела не идёт; в новый день счёт
      начинается заново.
  - evidence: test-run pass · `pnpm test test/unit/assistant-wake-gate.test.ts` exit 0 · mac - · 2fa4a5519c5c61eaf7880667b4bc5c1d5fb8fbad
- [ ] Token-ы пишутся по каждому вызову — Session Assistant-а и проверки источника; unit test: сумма за день и за неделю,
      разбивка по источникам, по пробуждениям и по разговору.
  - evidence: test-run pass · `pnpm test test/unit/assistant-usage-ledger.test.ts` exit 0 · mac - · 2fa4a5519c5c61eaf7880667b4bc5c1d5fb8fbad
- [ ] Доля Assistant-а в окнах Limits отдаётся с пометкой, что это оценка; способ оценки записан в «Итог».
  - evidence: test-run pass · `pnpm test test/unit/assistant-usage-ledger.test.ts` exit 0 · mac - · 2fa4a5519c5c61eaf7880667b4bc5c1d5fb8fbad
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 2fa4a5519c5c61eaf7880667b4bc5c1d5fb8fbad

## Итог

- Красный до правки: `pnpm test test/unit/assistant-wake-gate.test.ts test/unit/assistant-usage-ledger.test.ts` — exit 1,
  оба файла не грузятся: нет `src/shared/assistant/budget.ts` и `src/main/assistant/budget/`.
- Проверка Limits обобщена: правила Terminal AI переехали в `src/main/agent/limits-gate.ts` (`limitsCheck`, вид вызова
  `automatic` или `on-demand`). `src/main/terminal-ai/limits-gate.ts` остался тонкой обёрткой: автоматические функции —
  `automatic`, по запросу — `on-demand`; его test не менялся и зелёный. Второго чтения Limits нет: на входе тот же
  `LimitsState`.
- Проверка перед пробуждением — `assistantWakeGate` в `src/main/assistant/budget/wake-gate.ts`: Limits, потом дневной
  предел. Ответ: `ok`, или причина `limits` (окно, статус, доля, `until` — сброс окна), или `daily-limit` (сколько
  пробуждений, предел, `until` — местная полночь). Её вызывает Ticket 06.
- Расход — `AssistantUsageLedger` в `src/main/assistant/budget/ledger.ts`, файл `<WORFY_DATA_DIR>/assistant/usage.json`.
  `noteWake` — автоматическое пробуждение, `noteCall` — вызов Session Assistant-а (`wake` или `conversation`) и проверка
  источника (`source-check` с именем источника), с `usage` и `costUsd` из события `result`; `noteOtherTurn` — ход любой
  другой Session worfy, для оценки доли. Сводка (`summary`) — за местный день и за неделю, всего, по источникам, по
  каждому пробуждению и по разговору. Чистые функции — `src/shared/assistant/budget.ts`, экран (Ticket-ы 14 и 15)
  берёт типы оттуда.
- Способ оценки доли Assistant-а в окне Limits — `cost-share`: доля окна × часть Assistant-а в стоимости всех ходов,
  которые worfy видел с начала окна (начало — сброс окна минус его длина: 5 часов или 7 дней). Стоимость — `total_cost_usd`
  SDK: она взвешивает модель и cache так же, как цена, и ближе к тому, что считает окно, чем сумма token-ов. Claude вне
  worfy (терминал, другая машина) worfy не видит, поэтому оценка завышает долю: это верхняя граница. Ответ всегда несёт
  `estimate: true` и `method: 'cost-share'`; окно без доли или без времени сброса оценки не получает.
- Решено без владельца (подтвердить):
  - дневной предел — 20 автоматических пробуждений за местный день, константа `ASSISTANT_DAILY_WAKE_LIMIT` в
    `src/shared/assistant/budget.ts`; настройку предела делает Ticket 15;
  - в предел входят и срочные пробуждения (защита от цикла пробуждений); сообщение пользователя — не пробуждение и в
    счёт не идёт;
  - пробуждение считается в момент решения, до старта Session: неудачное пробуждение тоже съедает предел;
  - срочное пробуждение проверяется как вызов по запросу — его держит только `rejected`; несрочное — как автоматическая
    функция Terminal AI: выше 80 % 5-часового окна, `allowed_warning` любого окна или `rejected`;
  - когда держат и Limits, и предел, ответ называет Limits;
  - день — местный день машины (часовой пояс системы, как у бюджета Autopilot-а), а не часовой пояс work hours
    Ticket-а 04; неделя — сегодня и шесть календарных дней до него;
  - файл хранит 8 суток, старое выбрасывается при каждой записи; ходы других Session-ов хранятся суммой по часам;
  - `noteOtherTurn` пока никто не вызывает: общей шины событий `result` в main нет, её делает ядро внимания (Ticket 03).
    Подключить её — Ticket 06 или 10 вместе с вызовами `noteCall`. До тех пор оценка равна доле всего окна — верхняя
    граница.
