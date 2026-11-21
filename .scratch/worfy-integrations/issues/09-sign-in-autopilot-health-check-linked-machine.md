# 09 — Sign in на экране и в chip-е, Restart для Integration, включённой на ходу, Autopilot только с флажком, строки Health check, права Linked machine

Type: task
Status: claimed 2026-11-21T22:05Z
Blocked by: 05, 07, 08
Source: [spec.md](../spec.md), «Ticket-ы», 9; «Волны», Wave 5; «Решение», 3 и 5; «Как пользователь идёт по экранам»,
4, 8 и 9; «Решения по реализации» → Статус, Health check, Autopilot, Linked machine; «Решения по test-ам» (e2e);
«Вопросы владельцу», Q4, Q7 и Q10; «Решено без владельца», 3;
[critic](../../../docs/product/critic/worfy-integrations-2026-11-20.md), возражения 1 и 3

Кто: агент.

Не платформенный Ticket (renderer, main, Autopilot; окно входа — из Ticket-а 05). Глубина ревью — `high`: Autopilot
никогда не открывает окно входа, Linked machine не получает секретов.

## Что происходит

- Канал `integrations.signIn` и окно входа OAuth — Ticket 05 (`src/main/integrations/auth/oauth.ts`); кнопки на
  экране нет (Q10 (а): Sign in через OAuth появляется в этом Ticket-е, Wave 5).
- Строки chip-а «MCP n/m» Integration-ов есть у Claude (06) и Codex (07) в `src/shared/agent/mcp-status.ts`; действие
  Sign in у строки сервера пользователя сегодня зовёт `mcpAuthenticate` (`src/main/vendors/claude/mcp.ts:27-33`). У
  строки Integration Sign in должен открыть окно worfy. Возражение 1 critic-а: этот Ticket правит `mcp-status.ts`
  после 07.
- Integration, включённую в работающей Session, подключает Restart with the same conversation, как Allow сегодня
  (`docs/features/mcp-servers.md`, Epic worfy-mcp-live).
- Q7 (а): Integration доступна Autopilot-у (Run без человека) только с флажком «Available to Autopilot», как Browser
  profile (ADR-0078, пункт 10; `AUTOPILOT_ONLY`, `src/shared/browser/tools.ts:34-37`); набор фиксирован в начале Wave
  (Q6 worfy-mcp-live); окно входа без человека не открывается никогда.
- Health check: строки non-critical (ADR-0109; `severityOf`, `src/shared/health/severity.ts`; сообщения —
  `healthReports().reportFailure`, `src/main/first-run/health-reports.ts`).
- Linked machine («Решено без владельца», 3): Read only — список и статус; Full access — включить, выключить, фильтр,
  Autopilot, Sign in (окно открывается на Machine Project-а, как Sign in сегодня, `docs/features/mcp-servers.md:168-175`);
  Add integration и ввод token-а — только на своей Machine.

## Что делаем

1. Кнопка **Sign in** (и Re-sign in в меню «…») в разделе Integrations (`src/renderer/integrations/`) для Integration
   с OAuth: зовёт `integrations.signIn`; строка показывает `checking`, затем аккаунт и site. У Atlassian — «Sign in
   with Atlassian» и «API token» в Add integration.
2. Sign in у строки Integration в chip-е «MCP n/m» (`src/shared/agent/mcp-status.ts`, `src/renderer/session/McpChip.tsx`):
   открывает окно worfy, а не `mcpAuthenticate`.
3. Restart для Integration, включённой в работающей Session: строка в chip-е предлагает Restart with the same
   conversation; новый набор — через `sdkQueryFactory` (06) и `thread/start` (07).
4. Autopilot: Session без человека получает только Integration-ы с `autopilot: true`; набор фиксируется в начале Wave;
   tool Integration без флажка Session Autopilot не видит. Отказ входа в Autopilot — ответ tool-а «Sign-in needed:
   <метка>…» и строка Health check; окно не открывается; Run идёт дальше по своим правилам ошибок.
5. Health check: строка на каждую включённую Integration открытого Project-а в `needs-sign-in` или `error`:
   non-critical, «Jira — client A: sign-in needed», действие Sign in; id строк — в таблице `severityOf`; причина
   проходит `redactSecrets`.
6. Linked machine: проверка уровней доступа каналов `integrations.*` по «Решено без владельца», 3; окно входа,
   запущенное с Linked machine с Full access, открывается на Machine Project-а.

## Готово, когда

- [ ] Contract `test/contract/integrations-autopilot.test.ts` (новый) на fake query и fake app-server-е: Session
      Autopilot получает только Integration-ы с `autopilot: true`; набор не меняется посреди Wave; при
      `needs-sign-in` — ответ tool-а «Sign-in needed», строка Health check, `integrations.signIn` не вызван, окно не
      создано. Красный до правки — в «Итог».
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/integrations-autopilot.test.ts` exit 0 · mac - · e15625d08956845ce54c49f5195e0f12890fad7d
- [ ] Contract `test/contract/integrations-health.test.ts` (новый): строка Health check на Integration в
      `needs-sign-in` — non-critical, с действием Sign in; token в тексте строки нет.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/integrations-health.test.ts` exit 0 · mac - · e15625d08956845ce54c49f5195e0f12890fad7d
- [ ] Тот же contract или `test/contract/integrations-linked-machine.test.ts` (новый): Read only — `list` и `status`;
      Full access — `setEnabled`, `setTools`, `setAutopilot`, `signIn` (окно — на Machine Project-а); `add`,
      `setSecret`, `remove` — отказ при любом уровне.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/integrations-linked-machine.test.ts` exit 0 · mac - · e15625d08956845ce54c49f5195e0f12890fad7d
- [ ] `test/unit/mcp-chip.test.tsx`: Sign in у строки Integration зовёт `integrations.signIn`, а не `mcpAuthenticate`;
      Restart у Integration, включённой на ходу.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/mcp-chip.test.tsx` exit 0 · mac - · e15625d08956845ce54c49f5195e0f12890fad7d
- [ ] e2e `test/e2e/integrations.spec.ts`: Sign in в окне worfy на OAuth-stub-е `test/fixtures/integrations/` → строка
      `signed-in` с аккаунтом; после неудачного refresh — «Sign-in needed» в строке, в chip-е и в Settings → Health.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e test/e2e/integrations.spec.ts` — exit 0; `ci-ok`
      зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · e15625d08956845ce54c49f5195e0f12890fad7d

## Где в коде

- `src/renderer/integrations/` (кнопка Sign in), `src/renderer/session/McpChip.tsx`
- `src/shared/agent/mcp-status.ts`
- `src/main/autopilot/` (набор Integration-ов на Wave), `src/main/vendors/claude/query.ts`, `src/main/vendors/codex/mcp.ts`
- `src/shared/health/severity.ts`, `src/main/first-run/health-reports.ts`
- `src/main/ipc/integrations.ts`
- `test/contract/integrations-autopilot.test.ts`, `test/contract/integrations-health.test.ts`,
  `test/contract/integrations-linked-machine.test.ts` (новые), `test/unit/mcp-chip.test.tsx`,
  `test/e2e/integrations.spec.ts`

Только читать: `src/main/integrations/auth/oauth.ts` (05), `src/shared/browser/tools.ts`, `docs/adr/0078-browser-node.md`,
`docs/adr/0109-health-check-row-levels-and-feature-reports.md`, `docs/adr/0066-read-only-access-for-a-linked-machine.md`,
`.scratch/worfy-mcp-live/spec.md` (Q6).

## Вне скоупа

- Документы — Ticket 10. Окно входа без человека — никогда. Slack — вне каталога (Q6).

## Итог

Сделано (PR этого Ticket-а).

- Sign in и Re-sign in для Integration с OAuth: строка раздела Integrations (`checking`, затем `Signed in` и site,
  без site — адрес сервера), Settings → Integrations (через первый Project, где она включена), Add integration
  («Sign in with Atlassian» рядом с «API token»; у Figma — только он). Linked machine с Full access нажимает Sign
  in, окно открывается на Machine Project-а; с Read only кнопка неактивна.
- Chip «MCP n/m» (Claude и Codex): строка Integration — `needs-auth` по статусу proxy с текстом «Sign-in needed:
  <метка>…»; её Sign in — окно worfy (`integrations.signIn`), Vendor-у `sign-in` для Integration отказан
  (`McpActionRefused`). Integration, включённая после старта Session с человеком, — строка `not-started` в группе
  «Enabled in this Project after this Session started.» с Restart Session; Codex теперь тоже `restarts`.
- Autopilot: набор читается на старте и в Wave не меняется (нет строки «not started», Restart отказан); отказ входа —
  ответ tool-а «Sign-in needed», строка Health check, окна нет.
- Health check: строка `integration` (non-critical) на пару Project + Integration в `needs-sign-in` или `error`,
  заголовок «Integration: <метка>», причина «<метка>: sign-in needed», у OAuth — Sign in; после входа строка
  уходит в OK (proxy сообщает каждую смену статуса, `clearStatus` после нового входа).
- Долги ревью 05/07/08: окно входа выпало из всех списков окон приложения (`dialogOwner`, меню, broadcast, link,
  linked) — structural test в `test/unit/sign-in-windows.test.ts`; Sign out и Remove OAuth Integration — revocation,
  `<id>:*`, partition; строка Codex отмечает заменённый сервер `config.toml`; строка Claude показывает
  `needs-sign-in` proxy; Settings пишет, почему Clean up ждёт при отложенном `integrations.json.unreadable-…`.

Красный до правки: те же 13 файлов test-ов до реализации — 12 файлов и 31 test красные
(`Cannot find module '/src/main/integrations/health'` в autopilot и health contract-ах; `dialogOwner` вернул окно
входа: «expected 'sign-in' to be 'app'»). `integrations-linked-machine.test.ts` был зелёным сразу: уровни доступа
каналов есть с Ticket-а 03, test их закрепляет.

Mutation testing: 22 мутанта, по одному на поведение, в копии под `mktemp -d` — все убиты. Привязка
`onStatus: integrationHealth(...)` в `integrationProxy()` приложения покрыта только e2e.

Решено без владельца — в отчёте PR и ниже:
- Аккаунта в строке нет: вход OAuth (`oauth.ts`, только чтение) пишет `account: null`, `site: null`; строка
  показывает адрес сервера. «С аккаунтом» из пункта e2e не выполнено.
- По умолчанию в Add integration выбран token, OAuth — второй вариант (Q10: token первым).
- Предупреждение о сервере `config.toml` — строка под строкой chip-а (`note`), не notice.
- Restart Integration, включённой на ходу, — только для Session с человеком.

Файлы вне списка Ticket-а: `src/main/first-run/checks.ts` (id `integration` не проверка Machine),
`src/main/agent/fake-query.ts` (id и факты строк для fake agent-а), `src/main/integrations/rows.ts` (новый, общие
строки Claude и Codex), `src/renderer/session/composer/McpServers.tsx` (Project у Session Node),
`src/renderer/integrations/model.ts`, `src/renderer/settings/IntegrationsSection.tsx`,
`scripts/e2e-specs.table.json` и `test/contract/ci-scope-e2e.test.ts` (integrations.spec.ts открывает Health),
`test/unit/health-severity.test.ts`, `test/unit/settings-health.test.tsx`, `docs/features/mcp-servers.md`.
