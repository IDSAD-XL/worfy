# 35 — Install Harness в Codex

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Windows» (Harness на Codex), «Решения владельца» (Q4, Q5); решение 08 ([08-harness-для-codex.md](08-harness-для-codex.md)); Ticket 04 ([04-codex-расширения-для-harness.md](04-codex-расширения-для-harness.md), «Как доставить и версионировать»); [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md); [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- Install Harness ставит копию `harness/` как локальный marketplace командами `claude plugin`
  (`src/main/harness/install.ts:6-24`, `:50-60`, папка — `:403`), с зависимостью `mattpocock-skills`
  (`harness/.claude-plugin/plugin.json`).
- Codex читает plugin-ы формата Claude: `codex plugin marketplace add <папка>`, `upgrade`, `list`; агентов plugin не
  несёт — их TOML лежат в `~/.codex/agents/` или `.codex/agents/` проекта. Зависимостей plugin-ов у Codex нет.

## Что делаем

1. `src/main/harness/codex-install.ts`: при входе в Codex Install Harness ставит ту же папку и в Codex
   (`codex plugin marketplace add`, при новой версии — `upgrade`); бинарник — закреплённый Codex (Ticket 17).
2. Зависимость `mattpocock-skills` ставится в Codex тем же installer-ом отдельным plugin-ом: у Codex нет поля
   зависимостей, а skills должны быть те же, что у Claude (решение Q5 — полный паритет).
3. Проверка версии — аналог `claude plugin list` у Codex; расхождение версий показывает тот же статус Harness.
4. `src/main/harness/codex-agents.ts`: из `harness/agents/implementer.md`, `reviewer.md`, `scout.md` — TOML агентов
   Codex (`name`, `description`, `developer_instructions`, `model`, `model_reasoning_effort`) с именами
   `worfy-implementer`, `worfy-reviewer`, `worfy-scout`. Только в `~/.codex/agents/` пользователя; в папку Project-а
   worfy не пишет (ADR-0005: своё состояние worfy держит вне репозитория). Пишет только installer; лишние файлы
   `worfy-*.toml` прежних версий он удаляет, чужие не трогает.
5. После установки или обновления installer сообщает, что hook-и нужно подтвердить в Codex (шаг — Ticket 39).
6. Ошибки команды Codex — тот же отчёт, что у установки в Claude Code; повтор на Windows — `retriedOnWindows`
   (`install.ts:164`).

Платформенный: пути установки и повтор на Windows.

## Готово, когда

- [ ] Contract test (stand-in `codex` через env, как test-ы установки Claude): первая установка, обновление, версия,
      plugin зависимости; TOML агентов `worfy-*` совпадают с fixture и лежат только в `~/.codex/agents/` временного
      `CODEX_HOME`; в папке Project-а ничего не появилось.
- [ ] Test-ы установки в Claude Code проходят без правок ожиданий.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, test-ы `src/main/harness` — exit 0.

## Где в коде

- `src/main/harness/codex-install.ts`, `src/main/harness/codex-agents.ts` (новые)
- `src/main/harness/install.ts` — `:6-24`, `:164`, `:403`
- `src/main/ipc/harness.ts`
- `test/contract/harness-codex-install.test.ts` (новый)

Только читать: `harness/agents/implementer.md`, `reviewer.md`, `scout.md`, `harness/.claude-plugin/plugin.json`.
