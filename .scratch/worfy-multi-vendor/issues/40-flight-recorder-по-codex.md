# 40 — Flight Recorder по Run-ам Codex

Type: task
Status: open
Blocked by: 34, 37
Source: [spec.md](../spec.md), «Цель и что видит пользователь» (второй выпуск); решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); spec Epic-а `worfy-flight-recorder` ([spec.md](../../worfy-flight-recorder/spec.md), «Источники»)

## Что происходит

- Flight Recorder берёт ходы Orchestrator-а и spans агентов из транскриптов Claude
  (`src/main/flight-recorder/transcripts.ts:1-10`, факты — `src/shared/flight-recorder/from-transcript.ts`):
  вызовы `Agent` с именем `impl-NN`, `SendMessage`, `task-notification`.
- У Codex агенты — thread-ы sub-агентов (Ticket 34), вызовы — `spawn_agent` / `send_message` / `followup_task`.

## Что делаем

1. Для Run с `vendor: codex` (Ticket 37) транскрипт Orchestrator-а и sub-агентов читается через `history.read`
   driver-а Codex, а не из `~/.claude/projects`.
2. Факты из событий: начало и конец span агента по `spawn_agent` и концу thread-а sub-агента; доработка
   `send_message` / `followup_task` — второй span.
3. Run на Claude — как сейчас.

## Готово, когда

- [ ] Contract test (фейк, Run на Codex с двумя sub-агентами): шкала Run с двумя spans агентов и ходами
      Orchestrator-а.
- [ ] Test-ы Flight Recorder на Claude проходят без правок ожиданий.
- [ ] `pnpm typecheck`, `pnpm lint`, test-ы Flight Recorder — exit 0.

## Где в коде

- `src/main/flight-recorder/transcripts.ts`
- `src/shared/flight-recorder/from-transcript.ts`
- `test/contract/flight-recorder-transcripts.test.ts`
