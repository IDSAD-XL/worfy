# 45 — Parity suite: гарантии workflow одинаковы на Claude и Codex

Type: task
Status: open
Blocked by: 35, 36, 44
Source: [spec.md](../spec.md), «Гарантии workflow на Codex», «Решения владельца» (Q5 — parity suite на фейке app-server); [ADR-0094](../../../docs/adr/0094-vendor-seam.md), «Гарантии workflow на Codex»; [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что делаем

`test/contract/codex-parity.test.ts`: каждая гарантия — один сценарий, который идёт дважды — на фейке Claude
(`WORFY_AGENT=fake`, hook-и Harness как у Claude Code) и на фейке app-server с hook-runner-ом (Ticket 44), с Harness,
установленным Ticket-ом 35 во временный `CODEX_HOME`. Итог обоих прогонов одинаков:

1. reviewer пытается править файл (tool правки и запись через shell) — отказ;
2. scout пытается править файл — отказ;
3. implementer заканчивает ход при красном gate — ход продолжается с причиной; при зелёном — заканчивается;
4. Subagent заканчивает ход при красном gate — так же;
5. guard Bash отказывает в запрещённой команде (тот же список, что в test-ах `guard.mjs`);
6. запись в `~/.claude` или `~/.codex` — отказ;
7. reviewer оставляет verdict-комментарий в PR через stand-in `gh` (`WORFY_GH`) — комментарий того же вида;
8. правила Harness приходят в начало Session и Subagent-а (`SessionStart`, `SubagentStart`);
9. hook-и Harness без подтверждения hash в Codex — отказ старта Run Autopilot ждёт Ticket 39; здесь — что фейк
   их не исполняет, и test называет это явно.

Новая гарантия Harness без строки в этом suite — красный test (список гарантий берётся из README Harness, раздел
«On Codex»).

Платформенный: test-ы скриптов Harness.

## Готово, когда

- [ ] Все 8 гарантий дают одинаковый итог на обоих фейках; п. 9 проверен.
- [ ] Контрольный случай: выключенный deny в `guard.mjs` — suite красный на Codex.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `test/contract/codex-parity.test.ts` (новый)

Только читать: `harness/README.md` (раздел «On Codex», Ticket 36), `test/fixtures/codex-app-server/hook-runner.mjs`.
