# 05 — Транскрипты всех Session Project-а: ходы и Subagent-ы за период

Type: task
Status: open
Blocked by: 04
Source: [spec.md](../spec.md), «Как работает» → «Чтение»; «Решения владельца», 2, 7; «Решено без владельца», 2, 3; «Риски», 1; [research 04](../../worfy-autopilot-queue/issues/04-данные-work-track.md), п. 2; [06](../../worfy-autopilot-queue/issues/06-объём-и-доступ-work-track.md), Q1, Q5

## Что происходит

- Reader Flight Recorder читает только транскрипт Orchestrator-а Wave-ов одного Run-а и Subagent-ов этих Wave-ов
  (`src/main/flight-recorder/transcripts.ts:7-17`); принадлежность Project-у — по `cwd` записей.
- За 30 дней у worfy — 3923 файла, 4.1 GB; главные файлы Session — 0.7 GB (research 04). Codex — `thread/list`
  (`src/main/vendors/codex/history.ts:6-12`), без архивных.

## Что делаем

1. `src/main/work-track/transcripts.ts`: все файлы Claude Code Project-а с mtime в периоде (и тот, что ещё пишется),
   потоковое чтение построчно, только поля времени, типа записи, вызова `Agent` (имя и `description`), исхода
   Subagent-а; текст prompt-ов и ответов не читается в память дальше строки. Факты `turn` и `subagent` (модель 04).
2. Session: `SessionInfo` — имя Node на Canvas, если Session на нём есть (скрытые — `hidden`), иначе «Session <id4>» и
   имя worktree; закрытые Session без Node — `archived`. Codex — через `history.ts`, с архивными, если app-server их
   отдаёт; нет — пробел «Codex archived threads».
3. Пробелы: начало периода раньше самого старого файла и срок `cleanupPeriodDays` (читается из настроек Claude Code
   только чтением, по умолчанию 30) — `SourceGap` с причиной.
4. Кэш в памяти по (путь, mtime, размер) на время жизни приложения; на диск ничего.

## Готово, когда

- [ ] Contract test на fixture Claude home: три Session (одна скрытая на Canvas, одна без Node), Subagent-ы, файл
      другого Project-а — не входит; факты с верными временами; текст prompt-ов не попал ни в один факт.
- [ ] Contract test: повторное чтение не читает файл заново, если mtime и размер те же; ничего не записано в fixture
      (ADR-0005).
- [ ] Contract test: fake Codex с двумя тредами — ходы Session на Codex.
- [ ] Замер на fixture в 200 MB — время в «Итог»; Week на Mac владельца — замер в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный.

## Тесты

- Contract `test/contract/work-track-transcripts.test.ts`, fixture-ы `test/fixtures/work-track/claude-home/**` (новые;
  без путей домашней папки).
- Сначала падающий: Session без Node не попадает в факты.

## Где в коде

- `src/main/work-track/transcripts.ts` (новый)
- `test/contract/work-track-transcripts.test.ts`, `test/fixtures/work-track/claude-home/**` (новые)

Только читать: `src/main/flight-recorder/transcripts.ts`, `src/shared/flight-recorder/from-transcript.ts`,
`src/main/vendors/codex/history.ts`, `src/main/claude-home/registry.ts`.
