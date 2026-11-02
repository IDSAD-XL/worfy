# 36 — Hook-и Harness под Codex

Type: task
Status: open
Blocked by: 35
Source: [spec.md](../spec.md), «Windows» (Harness на Codex); решение 08 ([08-harness-для-codex.md](08-harness-для-codex.md)); Ticket 04 ([04-codex-расширения-для-harness.md](04-codex-расширения-для-harness.md), «Гарантии Harness без механизма в Codex»); [ADR-0094](../../../docs/adr/0094-vendor-seam.md), «Последствия» (not enforced on Codex); [ADR-0055](../../../docs/adr/0055-harness-scripts-in-node.md); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), [ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md) (платформенный PR)

## Что происходит

- Gate fast — на `TaskCompleted` и `TeammateIdle` (`harness/hooks/hooks.json:62`, `:73`); `Stop` блокирует конец
  хода, пока gate красный (`:84`, `harness/hooks/stop.mjs`); guard Bash — `PreToolUse` (`:133`,
  `harness/hooks/guard.mjs`).
- У Codex нет `TaskCompleted` и `TeammateIdle` (незнакомые события он пропускает); `Stop` с `decision: "block"`
  продолжает ход; вход hook-а несёт `agent_type`.

## Что делаем

1. `stop.mjs`: под Codex (признак во входе hook-а) — запуск gate fast на `Stop`, блок с причиной, пока gate красный.
   Под Claude — как сейчас.
2. `guard.mjs`: попытка read-only для `reviewer` и `scout` — отказ `PreToolUse` на `apply_patch` (`Edit`, `Write`) по
   `agent_type`. Test на записанном входе hook-а Codex; пока его нет — reviewer Codex только советует, и это
   записано в README Harness.
3. `hooks.json` — без новых событий, если хватает `Stop` и `PreToolUse`; matcher-ы Codex (`apply_patch`) — рядом.
4. README Harness: раздел «On Codex» — что не исполняется (ADR-0094, «Последствия»).

Платформенный: скрипты Harness.

## Готово, когда

- [ ] Test скриптов Harness: вход `Stop` Codex с красным gate — блок с причиной; зелёный — без блока; вход Claude —
      поведение не изменилось.
- [ ] Test `guard.mjs`: вход `PreToolUse` Codex с `agent_type: reviewer` и `apply_patch` — отказ; у implementer —
      разрешено. Либо записано, почему test не доказал, и reviewer Codex помечен «advisory».
- [ ] Платформенный PR (ADR-0056, п. 2; ADR-0071): вердикт Windows до merge.
- [ ] Test-ы Harness (`harness/hooks/tests/`, `test/contract/harness-*.test.ts`) и `pnpm lint` — exit 0.

## Где в коде

- `harness/hooks/stop.mjs`, `harness/hooks/guard.mjs`
- `harness/hooks/hooks.json` — `:62`, `:73`, `:84`, `:133`
- `harness/hooks/tests/`
- `harness/README.md`
