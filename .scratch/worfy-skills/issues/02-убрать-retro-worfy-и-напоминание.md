# 02 — Убрать `retro` worfy и напоминание о нём; `retro` Matt Pocock на его место

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 2; «Как работает» → «Уход `retro` worfy»; «Решено без владельца», п. 5, 7; «Риски», п. 3, 6

Платформенный Ticket: hook-и Harness (`hooks.json`, `session-start.mjs`) запускаются в каждой Session на Mac и Windows,
у Claude Code и у Codex — Windows verdict до merge (ADR-0056). Глубина ревью — `high`.

Ждёт 01: оба правят `harness/skills/THIRD_PARTY.md` и `harness/evals/lib/coverage.json`.

## Что происходит

- `harness/hooks/session-end.mjs` делает одно: для Profile-а с `session.retro_reminder_after` дописывает строку в
  `<profile>/state/pending-retro.log` (`:1-8`, `:95-102`). Зовёт его запись `SessionEnd` в
  `harness/hooks/hooks.json:124-133`; вторая запись того же события — `bin/worktree-lock release` (`:134-142`).
- `harness/hooks/session-start.mjs` п. 4 напоминает о `/retro`, когда строк в логе не меньше порога (`:20-21`, `:139`,
  `:205-215`); заголовок файла (`:7`, `:11`) описывает поле.
- `harness/hooks/hook-stdin.mjs:24`, `:31` — время ожидания ввода для `session-end.mjs`.
- `harness/skills/retro/SKILL.md` — свой `retro` worfy; его шаги проверяет `test/contract/harness-retro-skill.test.ts`.
  Владелец: этот skill ни разу не вызывался ни в одном транскрипте.
- Контракт Profile-а: `harness/profiles/README.md:36` (`state/` — `pending-retro.log`), `:208` (поле
  `session.retro_reminder_after`).
- Код приложения поле не читает: grep `retro_reminder_after` по `src/` пуст; `src/main/workflow/profile.ts` читает
  Profile схемами zod без `.strict()`. `bin/profile` и `bin/project-connect` поле не проверяют.
- Test-ы, где есть поле или `session-end.mjs`: `harness/hooks/tests/session-hooks.test.sh` (`:57-59`, `:80-88`,
  `:191-205`, `:291-294`), `harness/hooks/tests/rules-hooks.test.sh:81`, `:584`,
  `harness/bin/tests/harness-home.test.sh:207`, `:218`, `:304`, `test/contract/harness-hook-stdin.test.ts:435-447`,
  `test/contract/harness-codex-hooks.test.ts:446-451`, `test/contract/codex-parity.test.ts:376`, `:401`, `:668-669`.
- `HANDOFF.md:60` ждёт «первый `retro` на настоящем сбое» (ручной пункт worfy-reliability 09).

## Что делаем

1. Удалить `harness/hooks/session-end.mjs` и его запись в `hooks.json`; запись `worktree-lock release` остаётся.
   Описание `hooks.json` («session bookkeeping») — по сделанному.
2. `session-start.mjs`: убрать п. 4 и упоминания поля; Profile без `session.inject_rules: true` — пустой вывод, даже с
   `session.retro_reminder_after`.
3. `hook-stdin.mjs`: убрать строку `session-end.mjs`.
4. `harness/skills/retro/` — заменить на `retro` Matt Pocock 1.3.1 (`SKILL.md`, `agents/openai.yaml`), ссылка
   `writing-for-agents` → `worfy:writing-for-agents`; строка в `THIRD_PARTY.md`; запись в `coverage.json`.
5. `harness/profiles/README.md`: поле — «removed in worfy-skills 02; ignored if present»; `state/` без
   `pending-retro.log`.
6. Test-ы: случаи `session-end.mjs` и напоминания удалить; добавить случай «Profile с полем — SessionStart как без него,
   лог не пишется»; `harness-retro-skill.test.ts` удалить.
7. Contract test: Profile с `session.retro_reminder_after: 3` читает `bin/profile` (exit 0), проходит
   `bin/project-connect --schema-only` и загружается кодом приложения (`test/contract/workflow-profile.test.ts`).
8. `HANDOFF.md:60` — убрать строку (skill-а, о котором она, больше нет).
9. Файлы `state/pending-retro.log` на машинах не трогать.

## Готово, когда

- [ ] `harness/hooks/session-end.mjs` нет; `hooks.json` не зовёт его; `SessionEnd` зовёт только
      `bin/worktree-lock release`.
- [ ] Test: Profile с `session.retro_reminder_after` и без `inject_rules` — SessionStart печатает пусто, exit 0;
      `pending-retro.log` не создаётся ни SessionStart, ни SessionEnd (Claude Code и Codex).
- [ ] Test: такой Profile читают `bin/profile`, `bin/project-connect --schema-only` и приложение — без ошибки.
- [ ] `harness/skills/retro/SKILL.md` — `retro` Matt Pocock с `disable-model-invocation: true`; test Ticket-а 01 зелёный
      и на нём.
- [ ] `bash harness/hooks/tests/session-hooks.test.sh`, `bash harness/hooks/tests/rules-hooks.test.sh`,
      `bash harness/bin/tests/harness-home.test.sh` — exit 0 на Mac.
- [ ] Те же три на Windows (Git Bash) — exit 0.
  - needs: windows
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный (Linux, macOS и Windows job-ы).

## Тесты

- Shell `harness/hooks/tests/session-hooks.test.sh`, `rules-hooks.test.sh`, `harness/bin/tests/harness-home.test.sh`.
- Contract `test/contract/harness-hook-stdin.test.ts`, `harness-codex-hooks.test.ts`, `codex-parity.test.ts`,
  `workflow-profile.test.ts`.
- Сначала падающий: случай «Profile с полем — лог не пишется» красный на `main` (сегодня лог пишется).

## Где в коде

- `harness/hooks/session-end.mjs` (удалить)
- `harness/hooks/session-start.mjs`
- `harness/hooks/hooks.json`
- `harness/hooks/hook-stdin.mjs`
- `harness/hooks/tests/session-hooks.test.sh`
- `harness/hooks/tests/rules-hooks.test.sh`
- `harness/bin/tests/harness-home.test.sh`
- `harness/skills/retro/**`
- `harness/skills/THIRD_PARTY.md`
- `harness/profiles/README.md`
- `harness/evals/lib/coverage.json`
- `test/contract/harness-retro-skill.test.ts` (удалить)
- `test/contract/harness-hook-stdin.test.ts`
- `test/contract/harness-codex-hooks.test.ts`
- `test/contract/codex-parity.test.ts`
- `test/contract/workflow-profile.test.ts`
- `HANDOFF.md`

Только читать: `src/main/workflow/profile.ts`, `src/main/harness/migrate/plan.ts` и `profiles.ts` (список `retro` там —
имена skills старого Harness для переноса из `~/.claude/skills`, он не меняется), `test/contract/harness-migrate.test.ts`,
`test/fixtures/claude-home-legacy/` (старый Harness), `docs/features/` (Ticket 04).
