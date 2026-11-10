# 100 — Новые модели Claude в списке моделей: подъём Agent SDK до 0.3.322 и Dependabot на его новые версии

Type: bug
Status: claimed 2026-11-10T15:47Z
PR: —
Branch: worfy-polish/100
Blocked by: —
Source: владелец 2026-11-10 (бриф Orchestrator-а): «Список доступных моделей Worfy не обновляется с появлением
новых… вышел новый Fable 5.2, но его нет в списке.» Платное снятие fixtures и запись транскриптов в
`~/.claude/projects` — разрешение владельца 2026-11-10 (через Orchestrator-а).

## Что происходит

Строки model picker-а — ответ `query.supportedModels()` того Claude Code, который запускает worfy
(`src/main/vendors/claude/session.ts`, `src/main/agent/session/models.ts` — отбрасывает только haiku). Своего списка
у worfy нет. Собранное приложение запускает бинарник платформенного пакета SDK (ADR-0057,
`claudeExecutablePath()` в `src/main/vendors/claude/options.ts`), а `package.json` держит
`@anthropic-ai/claude-agent-sdk` на 0.3.289 (Claude Code 2.1.289). В таблице моделей этого бинарника Fable 5.2 нет:
`fable` у него — Fable 5.1. На npm уже 0.3.322 (2026-11-10, Claude Code 2.1.322). Список стар ровно настолько,
насколько стар SDK, и никто не узнаёт о новой версии: `.github/dependabot.yml` нет.

## Что делаем

1. Поднимаем `@anthropic-ai/claude-agent-sdk` до 0.3.322 (`package.json`, `pnpm-lock.yaml`; платформенные пакеты —
   его optional dependencies, отдельно нигде не закреплены; `electron-builder.yml` распаковывает их маской
   `node_modules/@anthropic-ai/claude-agent-sdk-*/**`).
2. По уроку `docs/lessons/agents.md` («Agent SDK поднимать только до сборки с Claude Code 2.1.299 или новее и в том же
   PR заново снимать fixtures») снимаем `test/fixtures/sdk-messages/` заново на новом SDK и обновляем test-ы,
   которые держатся за значения старого снятия.
3. `.github/dependabot.yml`: npm, каждый день, только `@anthropic-ai/claude-agent-sdk*` одной группой.

## Готово, когда

- [ ] `package.json` и `pnpm-lock.yaml` на 0.3.322, установленный пакет — Claude Code 2.1.322; `pnpm typecheck` exit 0.
- [ ] `supportedModels()` бинарника 0.3.322 отдаёт `fable` = «Fable 5.2» (и `claude-fable-5-1`), у 0.3.289 —
      `fable` = «Fable 5.1»; проверено без вызова модели (query без prompt-а).
- [ ] `test/fixtures/sdk-messages/` сняты заново на Claude Code 2.1.322, `manifest.json` — `node scripts/sdk-compat.mjs
      manifest`; `background-tasks.jsonl` снимается сценарием `sdk-probe.ts`, а не потерянным одноразовым скриптом;
      личные слова владельца не попадают в fixtures (`node scripts/check-personal.mjs` exit 0).
- [ ] `test/contract/sdk-compat.test.ts`, `test/contract/agent-events.test.ts`, `test/unit/agent-options.test.ts`,
      `test/contract/limits.test.ts`, `test/unit/claude-events.test.ts` зелёные на новом снятии; весь `pnpm test` exit 0.
- [ ] `.github/dependabot.yml` есть; Dependabot PR идёт через тот же `ci.yml` (`pull_request`, без secrets).
- [ ] e2e spec-и Session, model picker, Terminal AI, limits, narrator — exit 0.
- [ ] gate fast — exit 0; `ci-ok` на PR зелёный.

## Где в коде

- `package.json`, `pnpm-lock.yaml` — версия SDK.
- `.github/dependabot.yml` — новый.
- `test/fixtures/sdk-messages/*` — новое снятие, `README.md`.
- `scripts/spikes/sdk-probe.ts` — сценарий `background-tasks`, resolver gate из `harness/hooks/` (старый путь
  `~/.claude/hooks/gate-resolve.mjs` исчез с переходом на plugin), личные слова → `<personal>`.
- `scripts/spikes/harness-plugin/probe.ts` — личные слова → `<personal>`.
- `scripts/sdk-compat.mjs` — `model_usage_since_last_result` как запись по модели.
- `test/contract/sdk-compat.test.ts`, `test/contract/agent-events.test.ts`, `test/unit/agent-options.test.ts`,
  `test/contract/limits.test.ts`, `test/unit/claude-events.test.ts` и его запись `test/fixtures/sdk-events/claude.json`.
- `src/main/agent/fake-query.ts`, `src/main/vendors/claude/options.ts` — комментарии с версией SDK.
- `docs/lessons/agents.md` — номер строки проверки урока.

## Вне скоупа

- Свой список моделей в worfy или запрос каталога моделей мимо Claude Code.
- Другие зависимости в Dependabot.
