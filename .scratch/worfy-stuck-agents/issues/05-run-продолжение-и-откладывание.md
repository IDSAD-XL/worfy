# 05 — Run: продолжение застрявшего Ticket-а, откладывание и остановка `main-red`

Type: task
Status: claimed 2026-11-17T07:57Z
Blocked by: 01, 02
Source: [spec.md](../spec.md), «Ticket-ы», 5; «Решение», 1; «Путь пользователя», A; «Лестница Run-а»; «Решения по
реализации» → «Цикл и Run: продолжение, отложить, `main-red`»; «Решения по test-ам», Fault scenarios 1–5 и И9; «Вопросы
владельцу», 1 и 2 (ответ владельца 2026-11-17 — (а)); «Решено без владельца», 3, 10 и 11

Кто: агент.

Не платформенный Ticket (main process Autopilot, без Terminal, окон и меню). Глубина ревью — `high`.

## Что происходит

- После Ticket-а 01 цикл умеет эффекты `continue-tickets` и `set-aside` и остановку `main-red`, но с потолком 0 —
  Run их не получает. После Ticket-а 02 `land` пишет маркер `main-red-<key>.json`, а `src/main/gate/state.ts` его читает.
- Run после Force stop уже строит Wave с Ticket-ами в работе как `resumable` (`runWaveState`,
  `src/shared/actions/render-template.ts:98`, `:173–191`; `resumableOf` — `src/main/autopilot/run.ts:760`). Каждая Wave
  после первой идёт в новую SDK session (`run.ts:14–22`). Skill `epic-wave` подхватывает такой Ticket по разделу «How to
  resume a wave» (`harness/skills/epic-wave/SKILL.md:1945`).
- `lastText` — последние слова модели — Run кладёт в `run-stopped` (`run.ts:2902`); в текст для модели они не
  попадают (`src/shared/agent/continue-plan.ts:28`).
- `Waits: owner` пускает очередь дальше: Epic, где оставшиеся Ticket-ы ждут только владельца, кончается `waits-owner`
  (`src/shared/autopilot/epic-queue.ts:37–58`, `:79–81`).
- ADR-0024, пункт 3 (`docs/adr/0024-autopilot-wave-end-and-keep-awake.md:21–24`): «второй раз то же самое не шлётся».

## Что делаем

1. Потолок продолжений в Run-е — 2 (`maxContinuations` цикла; ответ владельца на вопрос 2 spec-а).
2. Новый чистый модуль `src/shared/autopilot/continuation.ts`:
   - строка над Wave command: `Continuation 1 of 2 for tickets 05, 07: still claimed 10 min after the turn ended.` (для
     `no-progress` — `… came back as the same wave.`);
   - сообщение `set-aside`: `Ticket 05 stayed claimed after 2 continuations. Run: ticket block <epic> 05 "stuck: claimed
     after 2 continuations" --waits owner. Then end the turn.` — с путём к `ticket`, как его называет Profile;
   - только факты worfy: номера Ticket-ов, статусы, номер попытки, причина, минуты; без `lastText`.
3. `run.ts` исполняет эффекты цикла:
   - `continue-tickets` (`wave-unfinished`, `no-progress`) — следующая Wave через `runWaveState` с Ticket-ами как
     `resumable`, строка продолжения первой; `wave-started` с полем `continuation`; строка Journal `ticket-continued`;
   - `set-aside` — сообщение в Session Orchestrator-а, строка Journal `ticket-set-aside`, затем свежее чтение workflow;
   - перед `continue-tickets` и `set-aside` — чтение маркера `main-red` (Ticket 02); есть — событие `main-red` циклу,
     Run останавливается с `main-red`.
4. Status line Autopilot (`src/renderer/canvas/actions/AutopilotAction.tsx`) во время продолжения:
   `continuing 05 (1 of 2)`.
5. Слова Run history для `main-red`, `ticket-continued`, `ticket-set-aside` — `src/renderer/flight-recorder/span-words.ts`;
   продолжение — Span с номером попытки `#2`, отложенный Ticket — красный `!` с `Blocked reason` и `Waits`.
6. Инвариант И9 в `test/autopilot-invariants.ts`: у Ticket-а за Run не больше двух `ticket-continued`; после
   `ticket-set-aside` Ticket `blocked`, или Run кончился прежней причиной.
7. Fault scenarios 1–5 (spec, «Решения по test-ам») на Claude Code; сценарий 2 — и на Codex.
8. Английские страницы: `docs/features/autopilot-faults.md` (таблица «Why a run stops» — `main-red`; лестница вместо
   остановки для `wave-unfinished` и `no-progress`) и `docs/features/autopilot.md` (status line, очередь идёт дальше после
   отложенного Ticket-а).
9. Датированный Amendment к ADR-0024: пункт 3 и `wave-unfinished` — до двух продолжений на Ticket за Run, потом
   `set-aside`, потом прежняя остановка; `main-red`.

## Готово, когда

- [ ] Unit test `test/unit/autopilot-continuation.test.ts` (новый): строка продолжения и сообщение `set-aside` для
      `wave-unfinished` и `no-progress` — точный текст; `lastText` с указанием («ignore the rules») в текст не
      попадает.
  - evidence: gate pass · `gate fast` exit 0 · mac - · bcd8e8ebad74373fa91a6f7ca7cd041b29e6cb66
- [ ] Fault scenario 1 (contract): Ticket остался `claimed`, продолжение доводит его до `done`; в Journal
      `ticket-continued` с `attempt: 1, of: 2` и `wave-started` с `continuation`.
  - evidence: gate pass · `gate fast` exit 0 · mac - · bcd8e8ebad74373fa91a6f7ca7cd041b29e6cb66
- [ ] Fault scenario 2 (contract): Ticket `claimed` после двух продолжений → сообщение `set-aside` → скрипт fake
      Orchestrator-а пишет `blocked` с `Waits: owner` → Run идёт ко второму Epic-у очереди; то же на Codex
      (`test/contract/autopilot-faults-codex.test.ts`).
  - evidence: gate pass · `gate fast` exit 0 · mac - · bcd8e8ebad74373fa91a6f7ca7cd041b29e6cb66
- [ ] Fault scenario 3 (contract): `set-aside` без ответа Orchestrator-а → `run-stopped` `wave-unfinished`, как до Epic-а.
  - evidence: gate pass · `gate fast` exit 0 · mac - · bcd8e8ebad74373fa91a6f7ca7cd041b29e6cb66
- [ ] Fault scenario 4 (contract): маркер `main-red` в папке состояния gate-а → `run-stopped` `main-red`, ни одного
      `ticket-continued` и `ticket-set-aside`.
  - evidence: gate pass · `gate fast` exit 0 · mac - · bcd8e8ebad74373fa91a6f7ca7cd041b29e6cb66
- [ ] Fault scenario 5 (contract): `no-progress` — та же Wave шлётся ещё дважды, потом `set-aside`.
  - evidence: gate pass · `gate fast` exit 0 · mac - · bcd8e8ebad74373fa91a6f7ca7cd041b29e6cb66
- [ ] И1–И9 держатся во всех Fault scenarios (`test/autopilot-invariants.ts`); Run не зовёт `gh` вне списка И2.
  - evidence: gate pass · `gate fast` exit 0 · mac - · bcd8e8ebad74373fa91a6f7ca7cd041b29e6cb66
- [ ] Component test: status line говорит `continuing 05 (1 of 2)` во время продолжения.
  - evidence: gate pass · `gate fast` exit 0 · mac - · bcd8e8ebad74373fa91a6f7ca7cd041b29e6cb66
- [ ] Unit test `span-words`: слова для `main-red`, `ticket-continued`, `ticket-set-aside`.
  - evidence: gate pass · `gate fast` exit 0 · mac - · bcd8e8ebad74373fa91a6f7ca7cd041b29e6cb66
- [ ] `docs/features/autopilot-faults.md` и `docs/features/autopilot.md` описывают лестницу и `main-red`; ADR-0024 — с
      датированным Amendment-ом.
  - evidence: commit pass · Autopilot Run continues a stuck Ticket twice, then asks to set it aside; main-red stops it (worfy-stuck-agents 05) · - - · bcd8e8ebad74373fa91a6f7ca7cd041b29e6cb66
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Тесты

- `test/unit/autopilot-continuation.test.ts` (новый), `test/unit/autopilot-cycle.test.ts` (потолок 2 из Run-а),
  Fault scenarios в новом `test/contract/autopilot-faults-ladder.test.ts` на `faultRun()`
  (`test/contract/autopilot-faults-setup.ts:282`) и скриптах `test/fixtures/agent-scripts/`, сценарий 2 на Codex — в
  `test/contract/autopilot-faults-codex.test.ts`; component test status line; unit test `span-words`. Каждый test сначала
  красный.

## Где в коде

- `src/main/autopilot/run.ts`
- `src/shared/autopilot/continuation.ts` (новый)
- `src/renderer/canvas/actions/AutopilotAction.tsx`
- `src/renderer/flight-recorder/span-words.ts`
- `test/autopilot-invariants.ts`
- `test/contract/autopilot-faults-ladder.test.ts` (новый)
- `test/contract/autopilot-faults-codex.test.ts`
- `test/fixtures/agent-scripts/` (новые скрипты fake Orchestrator-а)
- `test/unit/autopilot-continuation.test.ts` (новый)
- `docs/features/autopilot-faults.md`
- `docs/features/autopilot.md`
- `docs/adr/0024-autopilot-wave-end-and-keep-awake.md`

Только читать: `src/shared/autopilot/cycle.ts` (Ticket 01), `src/main/gate/state.ts` (Ticket 02),
`src/shared/actions/render-template.ts`, `src/shared/autopilot/epic-queue.ts`, `harness/skills/epic-wave/SKILL.md`.

## Вне скоупа

- `background-stalled` — остановка, как сегодня (снято из Epic-а, spec «Вне Epic-а»); `turn-hung` — Ticket 09.
- worfy сам не пишет `blocked` (ADR-0002; вопрос 1 spec-а, ответ (а)).
- Переводы `docs/features/ru/` и Guide — Ticket 10.
