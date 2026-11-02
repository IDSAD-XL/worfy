# 45 — Parity suite: Codex держит гарантии workflow, которые у Claude есть сейчас

Type: task
Status: open
Blocked by: 35, 36, 44
Source: [spec.md](../spec.md), «Гарантии workflow на Codex», «Решения владельца» (Q5 — parity suite на фейке app-server); [ADR-0094](../../../docs/adr/0094-vendor-seam.md), «Гарантии workflow на Codex»; [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что делаем

Паритет — Codex держит ровно те гарантии workflow, что Claude держит сейчас, не строже (решение Orchestrator-а,
round 2 review spec-а). Поведение Claude не меняется; фейк Claude (`WORFY_AGENT=fake`) hook-и не исполняет, и
hook-runner-а для него нет.

`test/contract/codex-parity.test.ts`: сценарии идут на фейке app-server с hook-runner-ом и sandbox-ом (Ticket 44), с
Harness, установленным Ticket-ом 35 во временный `CODEX_HOME`. Итог каждого сценария сверяется с таблицей гарантий
(данные в начале test-а). Каждая строка называет test, который доказывает ту же гарантию у Claude:

| # | Гарантия | Сценарий на Codex | Test Claude |
|---|---|---|---|
| 1 | reviewer и scout не правят файлы tool-ом правки | `apply_patch` (item `fileChange`) от `worfy-reviewer` и `worfy-scout` — отказ, файл не изменён; shell-команда — выполняется, как `Bash` у reviewer-а Claude | `harness/bin/tests/agents-text.test.sh:190` (`tools` агентов: без `Edit` / `Write`, с `Bash`) |
| 2 | ход не заканчивается при красном gate | `Stop` при красном gate — ход продолжается с причиной; при зелёном — заканчивается | `harness/bin/tests/harness-home.test.sh:131` (`stop.mjs` — exit 2 при красном маркере), `harness/hooks/tests/gate-notverified.test.sh` |
| 3 | Subagent не заканчивает работу при красном gate | `SubagentStop` — так же | `harness/hooks/tests/rules-hooks.test.sh:576-577` (gate fast на `TaskCompleted` и `TeammateIdle`), `harness/hooks/tests/gate-verdict.test.sh` (красный gate — не exit 0) |
| 4 | guard Bash | запрещённая команда (`git reset --hard`, pipe, который теряет exit code) — отказ | `harness/hooks/tests/guard-silent.test.sh:102-104` |
| 5 | правило записи в `~/.claude` | TOML агентов `worfy-*` от Ticket-а 35 несёт то же правило, что текст агентов Claude | `harness/bin/tests/agents-text.test.sh:178` |
| 6 | verdict review в PR | reviewer оставляет verdict-комментарий через stand-in `gh` (`WORFY_GH`), `GH_TOKEN` проекта в env | `harness/hooks/tests/gh-token-env.test.sh`, `harness/bin/tests/max-review.test.sh` |
| 7 | правила Harness в начале Session и Subagent-а | `SessionStart`, `SubagentStart` дают текст правил | `harness/hooks/tests/rules-hooks.test.sh:93` |
| 8 | учёт Session | `SessionEnd` пишет учёт и укладывается в 3 s | `harness/hooks/tests/session-hooks.test.sh` |
| 9 | hook-и включены | без подтверждения hash фейк их не исполняет; test называет это явно (отказ старта Run — Ticket 39) | нет: у Claude hook-и plugin-а включены всегда |

Правила таблицы:

- Если названный test Claude не доказывает гарантию строки целиком, Ticket добавляет новый test стороны Claude в
  `harness/hooks/tests/` или `harness/bin/tests/` — только test, без правки поведения.
- Test проверяет, что каждый названный файл test-а Claude существует: переименование без правки таблицы — красный test.
- Новая гарантия Harness без строки в таблице — красный test (список гарантий берётся из README Harness, раздел
  «On Codex», Ticket 36).
- Строгость не выше Claude: сценарий, который требует от Codex больше, чем test Claude доказывает у Claude (например,
  отказ в shell-записи reviewer-у), в таблицу не входит.

Платформенный: test-ы скриптов Harness.

## Готово, когда

- [ ] Все строки 1–8 дают на фейке app-server итог из таблицы; строка 9 проверена; у каждой строки есть test Claude
      или он добавлен.
- [ ] Контрольный случай: выключенный deny в `guard.mjs` — suite красный (строка 4); убранный отказ `apply_patch` для
      `worfy-reviewer` — красный (строка 1).
- [ ] Test-ы Harness стороны Claude проходят без правок ожиданий; фейк Claude не изменён.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` — exit 0.

## Где в коде

- `test/contract/codex-parity.test.ts` (новый)
- `harness/hooks/tests/` или `harness/bin/tests/` — новый test стороны Claude, только для строки без доказательства

Только читать: `harness/README.md` (раздел «On Codex», Ticket 36), `test/fixtures/codex-app-server/hook-runner.mjs`.
