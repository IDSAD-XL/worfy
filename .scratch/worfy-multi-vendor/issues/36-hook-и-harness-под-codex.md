# 36 — Гарантии Harness под Codex: gate, guard-ы, read-only reviewer и scout

Type: task
Status: done 2026-11-03T21:45Z
PR: #1308
Blocked by: 35, 44
Source: [spec.md](../spec.md), «Гарантии workflow на Codex», «Решения владельца» (Q5); решение 08 ([08-harness-для-codex.md](08-harness-для-codex.md)); Ticket 04 ([04-codex-расширения-для-harness.md](04-codex-расширения-для-harness.md), «Гарантии Harness без механизма в Codex»); [ADR-0094](../../../docs/adr/0094-vendor-seam.md), «Гарантии workflow на Codex»; [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- Gate fast — на `TaskCompleted` и `TeammateIdle` (`harness/hooks/hooks.json:62`, `:73`); `Stop` блокирует конец
  хода, пока gate красный (`:84`, `harness/hooks/stop.mjs`); guard Bash — `PreToolUse` (`:133`,
  `harness/hooks/guard.mjs`); учёт Session — `SessionEnd` (`:113`, `harness/hooks/session-end.mjs`).
- Read-only у Claude — список `tools` агентов `reviewer` и `scout` без `Edit` / `Write` (`harness/agents/`).
- У Codex нет `TaskCompleted` и `TeammateIdle`, нет списка `tools` у агента; `Stop` / `SubagentStop` с block
  продолжают ход; вход hook-а несёт `agent_type`; `SessionEnd` — не дольше 3 s.
- Владелец 2026-11-02 (Q5): гарантии workflow на Codex — те же, что на Claude, без «только совет».

## Что делаем

1. **Gate до конца Ticket-а.** `stop.mjs` под Codex (признак во входе hook-а) запускает gate fast на `Stop` и на
   `SubagentStop` и блокирует конец хода с причиной, пока gate красный: ни агент, ни Subagent не заканчивают работу
   с красным gate. `TeammateIdle` на Codex охранять нечего: agent teams у Codex нет.
2. **Read-only reviewer и scout** — ровно как у Claude сейчас: нет tool-а правки файлов, shell остаётся.
   `guard.mjs` под Codex отказывает `PreToolUse` на `apply_patch` (`Edit`, `Write`), когда `agent_type` —
   `worfy-reviewer` или `worfy-scout`; shell-команды им разрешены, как reviewer-у Claude (`Bash` в его `tools`). Первый шаг — проверить по записям Ticket-а 30 и по
   `codex-rs/hooks` закреплённой версии, что `agent_type` приходит в `PreToolUse`. Если нет — запасной путь в этом же
   Ticket-е: reviewer и scout идут отдельным thread-ом Codex с sandbox `read-only` (решение Q5), который
   запускает `bin/` Harness через app-server.
   Оба пути проверяемы на фейке Ticket-а 44 до выбора: он исполняет hook-и и эмулирует sandbox `read-only` thread-а.
3. **Guard-ы Bash и записи** — те же правила `guard.mjs` с matcher-ами Codex (`Bash`, `apply_patch`). Случай
   `write_stdin` в уже открытую unified exec Session (hook его не видит, Ticket 04) закрывается так: guard
   отказывает в интерактивной exec Session с записью ввода для `worfy-*` агентов.
4. **`SessionEnd` ≤ 3 s** — под Codex `session-end.mjs` делает только быстрые шаги (учёт и снятие lock-а);
   долгое — в следующий `SessionStart`.
5. **Verdict-ы review** — те же скрипты `bin/` и `gh`; `GH_TOKEN` для shell Codex — через env процесса app-server,
   если `SessionStart` Codex не может выставить env (Ticket 04, «Чего не знаем»).
6. README Harness: раздел «On Codex» — как держится каждая гарантия.

Под Claude поведение hook-ов не меняется.

## Готово, когда

- [ ] Test-ы hook-ов Claude (`harness/hooks/tests/`, `test/contract/harness-*.test.ts`) проходят без правок ожиданий.
- [ ] Test скриптов Harness на входах Codex: `Stop` и `SubagentStop` с красным gate — block с причиной, с зелёным —
      без блока; `PreToolUse` `apply_patch` от `worfy-reviewer` и `worfy-scout` — deny, от `worfy-implementer` —
      разрешено; shell-команда от reviewer — разрешена, как у Claude; `session-end.mjs` под Codex укладывается в 3 s.
- [ ] Выбранный путь read-only (п. 2) и его доказательство записаны в Ticket-е.
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] `pnpm lint` и test-ы Harness — exit 0.

## Где в коде

- `harness/hooks/stop.mjs`, `harness/hooks/guard.mjs`, `harness/hooks/session-end.mjs`
- `harness/hooks/hooks.json` — `:62`, `:73`, `:84`, `:113`, `:133`
- `harness/hooks/tests/`
- `harness/README.md`
