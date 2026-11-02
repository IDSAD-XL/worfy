# 27 — Session-ы Codex на Canvas

Type: task
Status: open
Blocked by: 22, 23, 24
Source: [spec.md](../spec.md), «Цель и что видит пользователь», п. 7, «Windows» (пути), «Решено без владельца», п. 9; решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); Ticket 05 ([05-codex-транскрипты.md](05-codex-транскрипты.md)); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- Session-ы Claude Project-а, начатые вне worfy, находит registry транскриптов (`src/main/claude-home/registry.ts`,
  `projectDirName` `:51`, `isInsidePath` `:80`) и показывает Node-ами (`src/renderer/claude-home/session-nodes.ts`).
- Канал — `claudeHome.*` (`src/shared/ipc/claude-home.ts`, `src/main/ipc/claude-home.ts`).
- У Codex папок по `cwd` нет; список даёт `history.list(cwd)` Ticket-а 22.

## Что делаем

1. `src/main/vendors/codex/sessions-on-canvas.ts`: Session-ы Codex Project-а — `history.list` по корню Project-а и
   его worktree; `cwd` сравнивается через `isInsidePath` (без учёта регистра на Windows).
2. Канал `claudeHome.*` отдаёт и Session-ы Codex с полем `vendor`; Node — со значком Vendor-а (Ticket 24),
   транскрипт — `history.read`.
3. Resume такой Node — Session Codex через driver; Session, начатая в терминале, — с подтверждением «This Session may
   be open in a terminal».
4. Обновление списка — опрос не чаще раза в 30 s, пока окно Project-а открыто (у Codex нет файла живых Session-ов).
5. Снимки в обеих темах — `.scratch/worfy-multi-vendor/evidence/27/`.

Платформенный: пути и сравнение путей.

## Готово, когда

- [ ] Contract test (фейк, `threads`): thread-ы с `cwd` в Project-е и в его worktree — найдены; чужой `cwd` — нет;
      `cwd` Windows с другим регистром — найден (test на правиле пути).
- [ ] e2e: Node Session Codex из терминала с транскриптом; Resume спрашивает подтверждение и продолжает thread.
- [ ] Снимки обеих тем в `evidence/27/`.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, test-ы `claude-home` и e2e spec — exit 0.

## Где в коде

- `src/main/vendors/codex/sessions-on-canvas.ts` (новый)
- `src/main/ipc/claude-home.ts`; `src/shared/ipc/claude-home.ts`
- `src/renderer/claude-home/session-nodes.ts`, `src/renderer/claude-home/useClaudeHome.ts`
- `test/contract/codex-sessions-on-canvas.test.ts`, `test/e2e/codex-sessions-on-canvas.spec.ts` (новые),
  `scripts/e2e-specs.table.json`

Только читать: `src/main/claude-home/registry.ts:51`, `:80`.
