# 05 — Limits с переключателем: окна `five_hour` и без него, нет окна, далёкий сброс

Type: task
Status: claimed 2026-11-06T02:32Z
Blocked by: 02
Source: [spec.md](../spec.md), «Цель» (окна у планов разные), «Как работает» → «Продолжение после Limits (B)»; «Сценарии» (строки Ticket-а 05); «Вопросы владельцу», Q2, Q7, Q8; уточнение владельца 2026-11-04 (верхний план без `five_hour`, планы ниже — с ним); [worfy-daily 05](../../worfy-daily/issues/05-ожидание-сброса-limits.md)

## Что происходит

- `resumeAt` (`src/shared/autopilot/resume-at.ts`): окно отказа, иначе самое позднее окно `rejected` из `limits.json`,
  плюс `RESUME_MARGIN_MS` 2 мин (`:14`); без времени — `RECHECK_MS` 30 мин (`:20`); дальше `MAX_WAIT_MS` 24 ч (`:27`) —
  `give-up` → `limits-timeout`.
- Окно в отказе — то, что сказал Vendor (`LimitsHit.window`); код не требует `five_hour`. Но test-ы
  `test/unit/autopilot-resume-at.test.ts` проверяют окна по отдельности, а случая «плана без `five_hour`, только
  `seven_day`» и «ни одного окна» вместе с переключателем нет.
- Квота без сброса у Codex — `limit_reached` `reason: 'quota'` (`src/shared/agent/events.ts:262-273`); Run сегодня ждёт
  её как окно без времени.
- Переключателя нет: ожидание включено всегда.

## Что делаем (по рекомендациям Q2, Q7, Q8; ответ владельца может поменять)

1. **Выключен** — `resumeAt` и `LimitsWait` ведут себя ровно как сегодня (24 ч, `limits-timeout`).
2. **Включён** — `resumeAt` получает `farReset: 'wait'`: сброс дальше 24 ч — план `at` (до сброса), не `give-up`;
   `LimitsWait` сообщает `keepAwake: false`, пока до сброса больше 24 ч, — `run.ts` отпускает keep-awake и берёт его
   снова, когда до сброса ≤ 24 ч (Q8 (в)).
3. **Нет окна** — как сегодня: `recheck` через `RECHECK_MS`; на Codex перед попыткой — `readCodexRateLimits`
   (`src/main/vendors/codex/limits.ts:119`), и если окно открыто — продолжение сразу. Для Codex это seam `peek()` в
   `LimitsWaitDeps`, в app — через Session Orchestrator-а.
4. **Квота** (`reason: 'quota'`) — `give-up` с причиной «quota without a reset», без ожидания, при любом положении
   переключателя.
5. `AutopilotState` — `waitingFor: 'limits'` и `resumesAt` как сегодня; для «нет окна» — `limitsWindow: null`, чтобы
   строка Ticket-а 07 показала «no reset time reported».

## Готово, когда

- [ ] Unit test `resumeAt`: stub Limits с `five_hour` и `seven_day`, отказ `five_hour` → сброс `five_hour` + 2 мин.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/autopilot-resume-at.test.ts` exit 0 · mac - · 54ae0d1836ff7a970dd707acaa7f58cd8032a30e
- [ ] Unit test: stub только с `seven_day` (верхний план) → сброс `seven_day`; `five_hour` нигде не нужен.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/autopilot-resume-at.test.ts` exit 0 · mac - · 54ae0d1836ff7a970dd707acaa7f58cd8032a30e
- [ ] Unit test: ни одного окна → `recheck` через 30 мин; квота → `give-up` с причиной.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/autopilot-resume-at.test.ts` exit 0 · mac - · 54ae0d1836ff7a970dd707acaa7f58cd8032a30e
- [ ] Unit test: сброс через 3 дня — off → `give-up` (как сегодня), on → `at`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/autopilot-resume-at.test.ts` exit 0 · mac - · 54ae0d1836ff7a970dd707acaa7f58cd8032a30e
- [ ] Contract test: Run с переключателем on, отказ `seven_day` без `five_hour` → `limits-hit`, `waiting-until`, по
      таймеру test-а `resumed`; продолжение одно.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-limits-switch.test.ts` exit 0 · mac - · 54ae0d1836ff7a970dd707acaa7f58cd8032a30e
- [ ] Contract test: off — те же сценарии, что `test/contract/autopilot-limits.test.ts`, без изменений и зелёные.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-limits.test.ts` exit 0 · mac - · 54ae0d1836ff7a970dd707acaa7f58cd8032a30e
- [ ] Все Limits — stub-ы (`LimitsTracker` с часами test-а); настоящих Limits test нет.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/autopilot-limits-switch.test.ts` exit 0 · mac - · 54ae0d1836ff7a970dd707acaa7f58cd8032a30e
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 54ae0d1836ff7a970dd707acaa7f58cd8032a30e

## Тесты

- Unit `test/unit/autopilot-resume-at.test.ts` (дописать).
- Contract `test/contract/autopilot-limits-switch.test.ts` (новый); скрипты `autopilot-limits-weekly.jsonl`
  (`rate_limit_event` `seven_day`, без `five_hour`) и `autopilot-limits-no-window.jsonl` (без `resetsAt`).
- Сначала падающий: on, сброс через 3 дня — ожидание `at` красное (`give-up`).
- Прогнать `test/contract/autopilot*.test.ts`, `test/unit/autopilot-*.test.ts`.

## Где в коде

- `src/shared/autopilot/resume-at.ts`
- `src/main/autopilot/limits-wait.ts`
- `src/main/autopilot/run.ts` (keep-awake по `keepAwake`, настройка)
- `src/main/ipc/autopilot.ts` (зависимости `limits`, `:192`)
- `test/unit/autopilot-resume-at.test.ts`, `test/contract/autopilot-limits-switch.test.ts`
- `test/fixtures/agent-scripts/autopilot-limits-weekly.jsonl`, `test/fixtures/agent-scripts/autopilot-limits-no-window.jsonl` (новые)

Только читать: `src/shared/agent/limits.ts`, `src/main/agent/limits.ts`, `src/main/autopilot/power.ts`,
`src/main/vendors/codex/limits.ts`, `test/contract/autopilot-limits.test.ts`.

## Итог

PR #1473. Переключатель — Auto-continue Project-а; Run читает его через `AutopilotDeps.retry.enabled` (та же
настройка, что у повтора Ticket-а 04), поэтому `src/main/ipc/autopilot.ts` не менялся.

- Выключен — ожидание Limits ровно как раньше: сброс дальше 24 ч от первого отказа — `limits-timeout`.
- Включён — известный сброс дальше 24 ч ждём (`resumeAt` с `farReset: 'wait'`). Пока до продолжения больше 24 ч,
  Run отпускает keep-awake; второй таймер за 24 ч до продолжения берёт его снова. Если Mac проспал сброс, keep-awake
  берётся до отправки продолжения. Auto-continue, выключенный во время такого ожидания, читается по таймеру «за 24 ч»:
  Run останавливается с `limits-timeout`.
- Окно — любое: `five_hour` нигде не нужен, план только с `seven_day` ждёт сброса `seven_day`. План `at` теперь несёт
  имя окна; `AutopilotState.limitsWindow` (новое поле) — окно ожидания, `null` без времени сброса (для строки Ticket-а 07).
- Нет окна — без изменений: попытка каждые 30 мин в пределах 24 ч при любом положении переключателя.
- Квота без сброса — без изменений (worfy-multi-vendor 38): остановка сразу с `vendor-quota` и текстом ошибки Codex.

Решено без владельца:

- Пункт 3 тикета (seam `peek()` для Codex) не понадобился: чтение окон Codex перед продолжением уже есть
  (`stillRefused` в `run.ts`, `deps.usage.refresh(0, vendor)`, worfy-multi-vendor 38).
- Пункт 4 («квота → give-up с причиной»): остался план `quota` и причина `vendor-quota`, а не `give-up`/`limits-timeout`.
- keep-awake отсчитывается от времени продолжения (сброс + 2 мин), а не от самого сброса.
- Попытки без времени сброса и при включённом переключателе ограничены 24 ч от первого отказа.

Долг: ветка `resume()` → `plan(again, …)` (Codex: окно всё ещё исчерпано после ожидания, сброс дальше 24 ч) с
включённым переключателем не покрыта test-ом.
