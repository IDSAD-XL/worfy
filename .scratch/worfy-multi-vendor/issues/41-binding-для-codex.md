# 41 — Binding для Session-ов Codex

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Цель и что видит пользователь» (второй выпуск); решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); [CONTEXT.md](../../../CONTEXT.md), термин Binding

## Что происходит

- Сигналы Binding (Session → Ticket или Epic) читаются из транскриптов Claude и его Subagent-ов
  (`src/main/claude-home/binding-signals.ts:1-15`), разбор — `src/shared/binding/signals.ts`.

## Что делаем

1. `src/main/vendors/codex/binding.ts`: сигналы Binding Session Codex — из событий `history.read` (команды, правки
   файлов, ветка) тем же чистым разбором `src/shared/binding/signals.ts`; дочитывание — только новых ходов.
2. `binding-signals.ts` выбирает источник по Vendor-у Session.

## Готово, когда

- [ ] Contract test (фейк): Session Codex, которая правит файл Ticket-а и работает в его ветке, получает Binding.
- [ ] Test-ы Binding на Claude проходят без правок ожиданий.
- [ ] `pnpm typecheck`, `pnpm lint`, test-ы Binding — exit 0.

## Где в коде

- `src/main/vendors/codex/binding.ts` (новый)
- `src/main/claude-home/binding-signals.ts`
- `test/contract/codex-binding.test.ts` (новый)

Только читать: `src/shared/binding/signals.ts`, `src/shared/binding/resolve.ts`.

## Итог

- `src/main/vendors/codex/binding.ts` (новый): `CodexBindingSignals.session(root, id)` — сигналы Binding Session Codex из
  событий её thread-а, прочитанных history part-ом driver-а Codex (`HistoryPart.read(id, cwd)`, `thread/read`). Команда
  (`commandExecution`) идёт через тот же чистый разбор, что Bash-команда транскрипта Claude (`claimIn` из
  `src/shared/binding/signals.ts`): последний `ticket claim` — сигнал claim. cwd — папка последней команды, иначе папка
  thread-а: worktree `.claude/worktrees/<NN>` связывает правилом worktree. Ветка — та, что сейчас checked out в этой папке
  (`gitBranch` из `src/main/terminal-ai/git-branch.ts`, из файлов git, без процесса в обычном случае); папки нет — ветки нет.
- Дочитывание только нового: прочитанные события thread-а считаются, Codex спрашивается снова только когда последний
  список Codex Session-ов Project-а (`sessions-on-canvas.ts`, раз в 30 s) показывает новый `updatedAt` thread-а; новые
  события складываются поверх прежнего состояния. Событий меньше, чем прочитано, — другой thread, чтение с начала. Два
  запроса сразу делят одно чтение. Чтение не удалось — остаётся прежнее, одна строка в log, следующий запрос пробует снова.
- Выбор источника по Vendor-у: Vendor Session-а — тот, чья история её называет. `bindings.signals`
  (`src/main/ipc/bindings.ts`): есть транскрипт Claude — как раньше; нет — спрашиваются источники других Vendor-ов
  (`VendorBindingSignals`; в приложении — Codex), имя Vendor-а нигде не проверяется. Автоматический Archive
  (`sessionBindings` в `src/main/layout/archive.ts`, `vendorSignals`; подключение в `src/main/index.ts`) берёт те же
  сигналы, так что правило «ticket done» доходит и до Session Codex. Session-ы Claude — без изменений: test-ы Binding на
  Claude прошли без правок ожиданий.
- Test-ы: `test/contract/codex-binding.test.ts` (фейк, скрипт `test/fixtures/codex-scripts/thread-binding.jsonl`): Session
  Codex, которая пишет файл своего Ticket-а и работает в его worktree на ветке `worfy-demo/07`, связана с Ticket-ом по
  ветке; повторный запрос без изменения thread-а Codex не запускает; складываются только новые события; ветка из настоящего
  git-репозитория во временной папке, в которую ничего не пишется; CODEX_HOME не меняется; `bindings.signals` и Archive.

Решено без владельца, подтвердить:

- Правка файла Ticket-а сама Binding не даёт — как у Claude: Orchestrator правит много файлов Ticket-ов. Session Codex
  связывается веткой, папкой worktree или `ticket claim`, как Session Claude.
- Ветка — текущая ветка папки последней команды, а не записанная в thread: Codex хранит ветку только на момент начала
  thread-а (`Thread.gitInfo`), history part её не отдаёт, а Session, создавшая worktree позже, в той ветке не начиналась.
- Skill-сигналы (`$ship-ticket`, `$epic-wave`) и Subagent-ы Codex пока не читаются: Harness в Codex не установлен до
  тикетов 36 и 39, Subagent Codex — отдельный thread (тикет 34).
- Снимков нет: тикет не меняет UI (spec, тикет 41 — «Не UI»); линия Binding рисуется тем же кодом, что для Claude.

Для тикета 42 (документация второго выпуска): `docs/features/workflow.md:371` («read from the transcripts each time»),
`:404` (чтение — только `binding-signals.ts`) и `:422` (test-ы) не называют чтение Session Codex из её thread-а
(`src/main/vendors/codex/binding.ts`, `test/contract/codex-binding.test.ts`); `docs/features/vendors.md:83` — Binding
у Session Codex теперь есть.
