# 06: Scheduled run — worktree, Session Claude Code или Codex, исход, Attention item-ы, уведомления

Type: task
Status: open
Blocked by: 03, 13
Source: [spec.md](../spec.md), «Ticket-ы», 06; «Решения по реализации» («Scheduled run»); «Сбои и что видит
пользователь»; «Приватность»; решения владельца Q2, Q5, Q6, Q8, Q15, Q16 grilling-а и Q1 spec-а; разбор critic-а,
возражения 1 и 3; «Волны», Wave 4

Кто: агент. Глубина ревью — `high`: main сам пишет в репозиторий Project-а (исключение ADR-0005, Ticket 01).

## Что происходит

- Session с готовым текстом стартует только по щелчку (`assistant.start`, `src/shared/ipc/assistant.ts`). Unattended
  Session-ы есть только у Autopilot-а (`unattended`, `src/main/vendors/session.ts`).
- main worfy сам worktree-ы не делает; экран Changes `worktree add` отклоняет (`src/main/changes/git.ts`).
- Q15: каждый run — в worktree на ветке `schedule/<name>/<date>`; PR — только если просит prompt. Q16: уведомление
  только на ошибку или «нужен человек».

## Что строить

- `src/main/schedules/run.ts`:
  - проверка Project-а (есть, папка на месте, git), модели (Vendor её отдаёт; псевдоним ведёт к тому же id — Q4 spec-а)
    и согласия; иначе Skipped с причиной;
  - `git fetch` основной ветки (без сети — от локальной, пометка в истории); `git worktree add -b
    schedule/<slug>/<YYYY-MM-DD-HHmm> <Project>/.claude/worktrees/schedule-<slug>-<YYYYMMDD-HHmm> origin/<default>`;
  - Session на Canvas Project-а через seam Vendor-ов (ADR-0094), cwd — worktree, unattended, первое сообщение — текст
    из Schedule в момент старта; корни и контекст политики — из Ticket-а 13;
  - исходы: Done, Needs you (park, ошибка входа, Limits кончились), Error; Session остаётся на Canvas;
  - Attention item-ы источника `schedule` ядра внимания: needs-you, missed, needs-accept, paused-after-failures,
    project-not-found; проверить, держит ли ядро пункт без Project-а, иначе — только уведомление и состояние;
  - уведомления через `src/main/notify.ts` — только Error, Timed out, Needs you; имя Schedule и Project, без текста
    prompt-а;
  - после run-а: чистый worktree без коммитов сверх базы — удалить с веткой; иначе «worktree kept»; ветку с коммитами не
    удалять никогда;
  - перезапуск worfy посреди run-а — по ADR-0108; иначе Interrupted;
  - `git push` и `gh pr create` — park и Attention item (Q1 spec-а); правила allow для push нет.
- Log — id Schedule и run-а, исход; текст prompt-а — никогда.

## Где в коде

- `src/main/schedules/run.ts` (новый), `src/main/vendors/`, `src/main/assistant/core/sources.ts` (источник `schedule`,
  `projectOfPath`), `src/main/notify.ts`
- `test/unit/schedule-run-outcome.test.ts`, `test/contract/schedule-worktree.test.ts`,
  `test/contract/schedule-codex-start.test.ts` (новые)

## Test-ы

- Unit `schedule-run-outcome`: события Session → Done, Needs you, Error; park → Attention item и уведомление;
  уведомлений нет на Done и Skipped.
- Contract `schedule-worktree`: настоящий git во временном repo — ветка, база, чистый worktree удалён, с коммитом
  оставлен; идёт и на Windows runner-е.
- Contract `schedule-codex-start`: fake app-server Codex (`WORFY_CODEX=fake`) получает ровно принятый текст и unattended.
- Session Claude Code — `WORFY_AGENT=fake`. Сначала падающий test.

## Готово, когда

- [ ] Run делает worktree на ветке `schedule/<slug>/<YYYY-MM-DD-HHmm>` и стартует Session Claude Code или Codex с ровно
      принятым текстом; исходы, Attention item-ы и уведомления — по таблице сбоев spec-а.
- [ ] `schedule-run-outcome`, `schedule-worktree`, `schedule-codex-start` зелёные.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
