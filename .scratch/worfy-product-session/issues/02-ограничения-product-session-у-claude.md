# 02 — Ограничения Product Session у Claude: deny в PreToolUse, без `autopilot_start`, сильнейшая модель

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 1, 10; «Как работает» → «Ограничения»; «Вопросы владельцу», Q3, Q4, Q6, Q10; research [product-session-основа](../../../docs/research/2026-11-07-product-session-основа.md), разделы 2.2, 2.4

Платформенный Ticket: guard сравнивает пути файлов, на Windows — регистр, `\`, буквы дисков, junction-ы; Windows
verdict до merge (ADR-0056). Глубина ревью — `high`: это граница «Product Session не меняет код».

## Что происходит

- PreToolUse hook worfy только наблюдает и всегда отвечает `{}` (`toolUseHooks`,
  `src/main/vendors/claude/options.ts:325-335`). Подключается он в `sessionOptions` (`:557`).
- Главная Session не передаёт ни `allowedTools`, ни `disallowedTools`: поля поддержаны (`options.ts:559-560`), но в вызове
  `sessionOptions` из `sdkQueryFactory` их нет (`src/main/vendors/claude/query.ts:147-170`).
- `env` Session — окружение login shell (`options.ts:530`); своих переменных на Session нет.
- `autopilot_start` отказывает без `context.autopilotStart` (`src/main/mcp/canvas-server.ts:295`); сервер каждой
  Session строит `sessionCanvas` (`:508-521`) и сегодня всегда даёт `autopilotStart`.
- Модель Session — выбор пользователя (`settings.model`, `options.ts:544`; `null` — модель Vendor-а по умолчанию,
  `src/shared/agent/settings.ts:34-35`). Eco mode меняет только роли Subagent-ов Profile-а
  (`src/shared/agent/plan-preset.ts:22-24`).

## Что делаем

1. Чистая функция `productToolDecision(tool, input, projectRoot, platform)` в `src/main/agent/product-guard.ts`:
   - `Edit`, `MultiEdit`, `Write`, `NotebookEdit` — разрешено только под `docs/product/` Project-а (Silent mode — папка Q6 spec-а)
     после `realpath` ближайшей существующей папки; `..`, ссылка наружу, другой регистр на Windows и macOS — отказ;
   - `Bash` — отказ на известные команды записи: `bin/ticket`, `git commit|push|merge|rebase|reset`,
     `gh pr create|merge`, `pnpm`, `npm` (Q3 spec-а);
   - всё прочее — разрешено.
2. В Product Session `toolUseHooks` отвечает `{ hookSpecificOutput: { hookEventName: 'PreToolUse',
   permissionDecision: 'deny', permissionDecisionReason } }` по решению функции. Наблюдение (`observe`) остаётся.
   Форму ответа сверить с типами Agent SDK в `node_modules/@anthropic-ai/claude-agent-sdk`.
3. `sessionCanvas` получает вид Session; для Product Session сервер строится без `autopilotStart`.
4. `env` Product Session несёт `WORFY_SESSION_KIND=product` (его прочтёт hook правил, Ticket 10). Оставить место для
   `systemPrompt.append` правил Product Session (риск 1 spec-а), но текст правил — в Ticket 10.
5. Модель: Product Session стартует на alias `opus` и самом высоком effort модели; смена модели в ней отклоняется
   текстом (Q10 spec-а). Eco mode её не касается и так — test закрепляет.

## Готово, когда

- [ ] Unit test `productToolDecision`: `docs/product/x/map.md` — разрешено; `src/a.ts`, `docs/adr/0001.md`,
      `docs/product/../src/a.ts`, ссылка из `docs/product/` наружу — отказ; на `win32` — `DOCS\PRODUCT\x.md` и
      `C:/…` с другим регистром.
- [ ] Unit test: `bin/ticket done`, `git commit -m x`, `gh pr merge 1`, `pnpm test` — отказ; `git log`, `gh pr view 1`,
      `epic-status` — разрешено.
- [ ] Test `sessionOptions` Product Session: PreToolUse отвечает deny с причиной; обычная Session — `{}`, как раньше.
- [ ] Contract test: у Product Session `autopilot_start` отвечает отказом (`isError`); у обычной — как раньше.
- [ ] Test: `env` Product Session несёт `WORFY_SESSION_KIND=product`; модель — `opus`, смена модели отклонена.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный (Linux, macOS и Windows job-ы).
- [ ] Те же unit test-ы guard-а на Windows — exit 0.
  - needs: windows

## Тесты

- Unit `test/unit/product-guard.test.ts` (новый), `test/unit/agent-options.test.ts`.
- Contract `test/contract/canvas-tools.test.ts`, `test/contract/node-sessions.test.ts`.
- Сначала падающий: на `main` PreToolUse Product Session отвечает `{}` на `Write src/a.ts`.

## Где в коде

- `src/main/agent/product-guard.ts` (новый)
- `src/main/vendors/claude/options.ts`
- `src/main/vendors/claude/query.ts`
- `src/main/mcp/canvas-server.ts`
- `src/main/agent/node-sessions.ts`
- `src/main/agent/session-settings.ts`
- `src/main/agent/session.ts` (`Session.begin()` передаёт `kind` в SessionStart; `becomeAttended` его сохраняет)
- `src/main/vendors/session.ts` (поле `kind` в SessionStart)
- `src/main/vendors/claude/session.ts` (driver Claude передаёт `kind` в QueryRequest)
- `src/main/agent/session/types.ts` (поле `kind` в QueryRequest)
- `docs/features/autopilot-chat.md` (отказ `autopilot_start` у Product Session)
- `test/unit/product-guard.test.ts`
- `test/unit/agent-options.test.ts`
- `test/contract/canvas-tools.test.ts`
- `test/contract/node-sessions.test.ts`

Только читать: `src/main/vendors/claude/one-shot.ts:64-76` (`ONE_SHOT_DISALLOWED_TOOLS` — образец), `harness/hooks/guard.mjs:64-69`
(запрет правок по виду агента — образец текста отказа), `src/main/agent/auto-approve/roots.ts` (как Run сравнивает
пути на Windows).
