# 07: Проверка Harness при старте на Claude Code

Type: task
Status: done 2026-11-28T05:20Z
PR: #2353
Branch: worfy-harness-guarantees/07
Blocked by: 01
Source: [spec.md](../spec.md), «Ticket-ы», 07; «Решение», 4; «Набросок функции» (шаг 1, notice «Harness did not load»);
«Решения по реализации» («Проверка Harness при старте на Claude Code»); «Решения по test-ам», Seams (worfy) и «Сначала
падающий test», 07; «Волны», Wave 2

Кто: агент. Глубина ревью — `medium`.

## Что происходит

- Для Claude Code проверки hooks Harness нет: «A Vendor that runs a plugin's hooks without an approval (Claude Code)
  has no such part, and nothing is checked for it» (`src/main/vendors/harness-hooks.ts:1-5`). У Codex она есть —
  `hooks/list` перед Run (`src/main/vendors/codex/harness-hooks.ts`, часть драйвера `src/main/vendors/codex/index.ts:27`).
- `sdkInit` (`src/shared/vendors/claude/events.ts:25-33`) выбрасывает `plugins` и `plugin_errors`: Session, где plugin
  `worfy` не загрузился, ничего не говорит.
- `unattendedRefusal` (`src/main/agent/orchestrator.ts:569`) отказывает Autopilot только по Vendor-у с частью
  `harnessHooks` (`src/main/vendors/driver.ts:34`, `src/main/agent/app-orchestrators.ts:127`).

## Что строить

- `sdkInit` читает `plugins` и `plugin_errors` (формы — по fixture-у spike-а 01 в `test/fixtures/sdk-messages/`), событие
  `init` несёт их дальше.
- Session, которой worfy дал Harness (`sessionHarnessPlugin`, `src/main/vendors/claude/options.ts:714-716`; у legacy
  Harness — plugin по имени `worfy`), без plugin `worfy` в `plugins` или с записью `plugin_errors` для него получает
  notice:

  ```text
  Harness did not load
  worfy · hook-load-failed: <message from Claude Code>
  Guards and the gate do not hold in this Session.
  [Open Health]  [Copy details]
  ```

  Тексты UI — на английском (ADR-0074).
- Новый `src/main/vendors/claude/harness-hooks.ts` — часть `HarnessHooksPart` (`src/main/vendors/harness-hooks.ts:8-16`)
  драйвера Claude (`src/main/vendors/claude/index.ts`):
  - `trust(cwd)` делает запрос без модели с plugin-ами Session, как `inventoryOptions` (`options.ts:762-770`), и
    читает `system/init`;
  - если spike 01 подтвердил `get_hooks_listing`, читает и его ответ: hooks PreToolUse и Stop plugin-а `worfy` в
    списке и не выключены;
  - ответ — `approved` или `unknown` с причиной; `refusal` — текст отказа Autopilot.
- `unattendedRefusal` с этой частью отказывает Autopilot на Claude Code без Harness, как на Codex.
- Комментарий `src/main/vendors/harness-hooks.ts:1-5` меняется: у Claude Code часть теперь есть.

## Где в коде

- `src/shared/vendors/claude/events.ts` — `sdkInit` `:25-33`, `case 'init'` `:212-225`
- `src/main/vendors/claude/harness-hooks.ts` (новый)
- `src/main/vendors/claude/index.ts` — часть `harnessHooks` драйвера
- `src/main/vendors/harness-hooks.ts` — комментарий `:1-5`
- `src/main/vendors/claude/options.ts` — `sessionHarnessPlugin` `:714-716`, `inventoryOptions` `:762-770` (только
  читать или общий helper)
- `src/main/agent/orchestrator.ts` — `unattendedRefusal` `:569`
- `src/renderer/session/` — notice «Harness did not load» (файл — по месту, где Session рисует notice-ы)
- `test/unit/` — разбор `system/init` и часть `harnessHooks` Claude (новые файлы, имена — предложение:
  `claude-init-plugins.test.ts`, `claude-harness-hooks.test.ts`)
- `test/e2e/` — notice в Session по fake init с `plugin_errors` (новый spec-файл или существующий spec Session)
- Только читать: `src/main/vendors/codex/harness-hooks.ts`, `test/fixtures/sdk-messages/` (fixture spike-а 01)

## Test-ы

- Unit: разбор `system/init` с `plugins` и `plugin_errors` по fixture-у spike-а; init без `plugin_errors` для `worfy` —
  без notice.
- Unit: часть `harnessHooks` Claude на fake query — `approved`, `unknown` с причиной; `unattendedRefusal` с этой частью
  отказывает.
- E2e: notice в Session по fake init с `plugin_errors` (агент — `WORFY_AGENT=fake`).
- Сначала падающий test: init с записью `plugin_errors` для `worfy` сегодня не даёт notice; test ждёт notice.
- Без моделей и без сети: настоящие Claude и Codex test-ы не запускают.

## Готово, когда

- [ ] `sdkInit` читает `plugins` и `plugin_errors`; Session, где plugin `worfy` не загрузился или с ошибкой, показывает
      notice «Harness did not load» с Open Health и Copy details (unit и e2e, красный на старом коде).
  - evidence: test-run pass · `npx vitest run test/unit/claude-init-plugins.test.ts test/unit/session-view.test.tsx` exit 0 (red on origin/main c66e7215a; e2e test/e2e/harness-did-not-load.spec.ts runs in CI) · mac - · 033e10309cd186ec4c5fb175610e1f30f42faafb
  - evidence: review pass · PR #2353 · - - · 6deeb0d93012d0324621177b0f7812cf0b9455b8
- [ ] У драйвера Claude есть часть `harnessHooks`: запрос без модели читает `system/init` (и `get_hooks_listing`, если
      spike 01 его подтвердил) и отвечает `approved` или `unknown` с причиной.
  - evidence: test-run pass · `npx vitest run test/unit/claude-harness-hooks.test.ts test/contract/codex-harness-hooks.test.ts` exit 0 · mac - · 033e10309cd186ec4c5fb175610e1f30f42faafb
  - evidence: review pass · PR #2353 · - - · 6deeb0d93012d0324621177b0f7812cf0b9455b8
- [ ] Autopilot на Claude Code без Harness не стартует и называет причину, как на Codex.
  - evidence: test-run pass · `npx vitest run test/unit/claude-harness-hooks.test.ts test/contract/app-orchestrators.test.ts test/contract/codex-orchestrator.test.ts` exit 0 · mac - · 033e10309cd186ec4c5fb175610e1f30f42faafb
  - evidence: review pass · PR #2353 · - - · 6deeb0d93012d0324621177b0f7812cf0b9455b8
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/46107330983/job/140869607170 · ci - · 6deeb0d93012d0324621177b0f7812cf0b9455b8

## Итог

Сделано 2026-11-28 на SDK 0.3.322 (Claude Code 2.1.322). Модели, ключа и входа не было.

- `sdkInit` (`src/shared/vendors/claude/events.ts`) читает `plugins` и `plugin_errors`; событие `init` несёт `plugins`
  и `pluginErrors` (`src/shared/agent/events.ts`), только когда init перечислил `plugins`: init fake agent-а их не
  называет и остаётся прежним, так что записанные события Autopilot (`auto-approve-claude.test.ts`) не изменились.
  Запись `plugin_errors` чужой формы отбрасывается, а не весь init. Запись событий записанных SDK-сообщений
  `test/fixtures/sdk-events/claude.json` написана заново: изменились только 37 строк `init`.
- `src/main/vendors/claude/harness-hooks.ts` (новый): `harnessLoadProblems` и `harnessNotice` — разбор init против
  Harness, который worfy дал Session; `hooksListingAnswer` и `readClaudeHooks` — часть `harnessHooks` драйвера Claude
  (`src/main/vendors/claude/index.ts`). Handle Claude (`src/main/vendors/claude/session.ts`) шлёт notice «Harness did
  not load» после первого `system/init` процесса; фабрика query говорит handle-у, какой Harness она дала
  (`QueryRequest.harnessGiven`, `src/main/agent/session/types.ts`, `src/main/vendors/claude/query.ts`).
- Notice — блок с заголовком, строкой `worfy · <type>: <message>`, строкой «Guards and the gate do not hold in this
  Session.», кнопками Open Health (Settings → Health) и Copy details (ошибка, версия Claude Code, папка Session, папка
  Harness, загруженные plugin-ы): поля `title`, `details`, `action: 'open-health'` у notice,
  `src/renderer/session/fold.ts`, `Transcript.tsx` (`NoticeBlock`), `session.css`.
- `unattendedRefusal` (`src/main/agent/orchestrator.ts`) берёт `check()` части, если она есть, и ставит причину после
  отказа: «Autopilot did not start: the Harness hooks do not run in Claude Code. Claude Code lists no PreToolUse hook
  of the plugin worfy.» У Codex части `check` нет, отказ прежний. Интерфейс — `src/main/vendors/harness-hooks.ts`
  (комментарий `:1-5` переписан), комментарий `driver.ts` тоже.
- Feature pages: `docs/features/harness.md` (раздел Plugin, «When the copy did not load»; Implementation; тесты),
  `docs/features/autopilot.md` (вместо «A run on Claude Code is not checked»). Перевод `docs/features/ru/` не правился.

Расхождения текста Ticket-а с фактами spike-а 01 и с проверкой этого Ticket-а:

1. **Ошибка в `plugin_errors` называет папку, не `worfy`.** Для сломанного `hooks.json` запись —
   `harness-broken-hooks-json@inline` (fixture `init-plugin-errors.jsonl`, строка 2). Ошибка считается ошибкой Harness,
   если её `plugin` — `worfy@…`, или `<папка>@inline`, где папка — имя папки, которую worfy дал, или `path` строки
   `worfy` в `plugins`, или `inline[N]` (так `sdk.d.ts` называет папку, упавшую до имени; worfy других inline plugin-ов
   не даёт).
2. **`trust(cwd)` не читает `system/init`.** Без сообщения Claude Code `system/init` не шлёт. Проверено на binary SDK
   0.3.322 с временным HOME и `CLAUDE_CONFIG_DIR`, фиктивным ключом и `ANTHROPIC_BASE_URL` на закрытый порт: query с
   input-ом, который ничего не отдаёт, и копией `harness/` inline-plugin-ом прогнал hooks SessionStart и вернул ответ
   `getHooksListing()`, а `system/init` не пришёл ни с целой копией, ни со сломанным `hooks.json`. Поэтому часть читает
   только `get_hooks_listing` (подтверждён spike-ом): `approved`, когда у plugin-а `worfy` есть строки PreToolUse и
   Stop и ни одна не `disabled`. Проверено там же на опциях части (`harnessCheckOptions`: `settingSources` user,
   project, local, `strictMcpConfig`, `skipMcpDiscovery`): целая копия — строки `worfy@inline` без `disabled`;
   `disableAllHooks: true` в `settings.json` временного HOME — у каждой строки `disabled: true`; сломанный
   `hooks.json` — ни одной строки. `system/init` проверяет сама Session (notice), а не часть.
3. **Нет скрипта hook-а — ни notice, ни отказа.** `plugin_errors` пуст (spike, пункт 1), а `get_hooks_listing` строит
   список из `hooks.json`, так что строки на месте. `engines` Claude Code молча пропускает — тоже без notice.
4. **Старый Harness (legacy).** worfy не даёт ему plugin (ADR-0049), его hooks — строки `~/.claude/settings.json`.
   Notice считает только ошибку plugin-а `worfy`, если он у пользователя есть; отсутствие plugin-а не ошибка. Часть
   отвечает `approved` без проверки — `shortcut:` в `readClaudeHooks`: Autopilot на старом Harness стартует, как до
   Ticket-а. Иначе Autopilot e2e (`test/e2e/autopilot-world.ts` кладёт старый `bin/epic-status`) и машины без переезда
   отказывали бы.
5. **Fake agent (`WORFY_AGENT=fake`).** Фабрика fake agent-а не называет Harness: handle тогда сверяет ошибки только по
   имени `worfy` и папке из `plugins` init-а (так e2e видит notice). Часть под fake agent-ом читает `hooks.json` той
   копии, которую дал бы Session (`fakeHooksListingStarter`), без Claude Code.

За пределами trail-а (нужно для того же поведения): `src/main/vendors/claude/session.ts` и `query.ts` (handle и
фабрика — notice шлёт main), `src/main/agent/session/types.ts`, `src/shared/agent/events.ts`, `src/renderer/session/fold.ts`,
`session.css`, `src/main/vendors/driver.ts` (комментарий). Test-ы: `test/contract/app-orchestrators.test.ts` теперь
ставит `WORFY_AGENT=fake` и подменяет папку копии на `harness/` — иначе проверка части Claude запустила бы настоящий
Claude Code; в `test/contract/codex-orchestrator.test.ts` поправлен устаревший комментарий;
`test/contract/codex-harness-hooks.test.ts` ждёт у драйвера Claude его часть вместо её отсутствия;
`test/contract/agent-events.test.ts` ждёт у init `plugins` и `pluginErrors`; notice-блок — в
`test/unit/session-view.test.tsx`. Fake-скрипт — `test/fixtures/agent-scripts/harness-did-not-load.jsonl`.

Красный на старом коде: те же test-ы на дереве `origin/main` (c66e7215a) — `claude-init-plugins` (init без `plugins`
и `pluginErrors`; handle дал `['init', 'init']` без notice), блок в `session-view.test.tsx` (нет `notice-block`);
файлы с новым модулем там не импортируются. E2e `test/e2e/harness-did-not-load.spec.ts` локально не запускался
(правило владельца), его гонит CI.

Цена проверки перед Autopilot: каждый старт Run-а и каждая следующая Wave на Claude Code запускают Claude Code
(в моём опыте ответ через 0,3–3,4 с) и hooks SessionStart Harness-а в папке worfy (`terminal-ai`); предел — 15 с.
