# 02 — Убрать `retro` worfy и напоминание о нём; `retro` Matt Pocock на его место

Type: task
Status: done 2026-11-07T21:23Z
PR: #1598
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
  - evidence: test-run pass · `bash harness/hooks/tests/rules-hooks.test.sh` exit 0 · mac - · 35f51f2c0073f8431ef787b57d29495a9a0342c7
  - evidence: review pass · PR #1598 · - - · c23ab7d2fb0a137ae137ac2bab12394e5e8931c7
- [ ] Test: Profile с `session.retro_reminder_after` и без `inject_rules` — SessionStart печатает пусто, exit 0;
      `pending-retro.log` не создаётся ни SessionStart, ни SessionEnd (Claude Code и Codex).
  - evidence: test-run pass · `bash harness/hooks/tests/session-hooks.test.sh` and `vitest run test/contract/harness-codex-hooks.test.ts test/contract/codex-parity.test.ts` exit 0 · mac - · 35f51f2c0073f8431ef787b57d29495a9a0342c7
  - evidence: review pass · PR #1598 · - - · c23ab7d2fb0a137ae137ac2bab12394e5e8931c7
- [ ] Test: такой Profile читают `bin/profile`, `bin/project-connect --schema-only` и приложение — без ошибки.
  - evidence: test-run pass · `vitest run test/contract/workflow-profile.test.ts -t retro_reminder_after` exit 0 · mac - · 35f51f2c0073f8431ef787b57d29495a9a0342c7
  - evidence: review pass · PR #1598 · - - · c23ab7d2fb0a137ae137ac2bab12394e5e8931c7
- [ ] `harness/skills/retro/SKILL.md` — `retro` Matt Pocock с `disable-model-invocation: true`; test Ticket-а 01 зелёный
      и на нём.
  - evidence: test-run pass · `vitest run test/contract/harness-third-party-skills.test.ts` exit 0 · mac - · 35f51f2c0073f8431ef787b57d29495a9a0342c7
  - evidence: review pass · PR #1598 · - - · c23ab7d2fb0a137ae137ac2bab12394e5e8931c7
- [ ] `bash harness/hooks/tests/session-hooks.test.sh`, `bash harness/hooks/tests/rules-hooks.test.sh`,
      `bash harness/bin/tests/harness-home.test.sh` — exit 0 на Mac.
  - evidence: test-run pass · `bash session-hooks, rules-hooks, harness-home .test.sh` exit 0 · mac - · 35f51f2c0073f8431ef787b57d29495a9a0342c7
  - evidence: review pass · PR #1598 · - - · c23ab7d2fb0a137ae137ac2bab12394e5e8931c7
- [ ] Те же три на Windows (Git Bash) — exit 0.
  - needs: windows
  - evidence: review pass · PR #1598 · - - · c23ab7d2fb0a137ae137ac2bab12394e5e8931c7
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный (Linux, macOS и Windows job-ы).
  - evidence: test-run pass · `pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 35f51f2c0073f8431ef787b57d29495a9a0342c7
  - evidence: gate pass · `gate fast` exit 0 · mac - · 35f51f2c0073f8431ef787b57d29495a9a0342c7
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42411364604/job/128526188787 · ci - · c23ab7d2fb0a137ae137ac2bab12394e5e8931c7

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

## Итог

Ветка `worfy-skills/02`.

### Что убрано

- `harness/hooks/session-end.mjs` удалён; в `hooks.json` у `SessionEnd` осталась одна запись —
  `bin/worktree-lock release`. Описание `hooks.json`: «session bookkeeping» → «the project's context at session start».
- `session-start.mjs`: п. 4 (напоминание о `/retro`) и чтение `session.retro_reminder_after` убраны. Profile без
  `inject_rules`, в Full mode и с attribution on — пустой вывод, даже с этим полем.
- `hook-stdin.mjs`: строка `session-end.mjs` в `FIRST_BYTE_MS` и её описание убраны.
- Свой `retro` worfy (`harness/skills/retro/SKILL.md`) и `test/contract/harness-retro-skill.test.ts` удалены.
- `HANDOFF.md`: строка про первый `retro` на настоящем сбое убрана.
- `harness/profiles/README.md`: поле `session.retro_reminder_after` — «removed; ignored if present», `state/` без
  `pending-retro.log`, `retro` убран из читателей `language.docs` и `lessons` (`retro` Matt Pocock их не читает).

### `retro` Matt Pocock

Скопирован из установленной копии 1.3.1 (`skills/engineering/retro/`): `SKILL.md` и `agents/openai.yaml`.
Правки — только две ссылки на `writing-for-agents` → `worfy:writing-for-agents` (`SKILL.md:11` — вызов Skill tool,
`:44` — «the … skill»). В spec названа только строка 11; строка 44 — та же ссылка, test Ticket-а 01 («names a skill …
only with the worfy: prefix») её ловит.

| Файл | 1.3.1 | копия | |
| --- | --- | --- | --- |
| `retro/SKILL.md` | `33fbc28568e3` | `9947999f3554` | правка ссылок |
| `retro/agents/openai.yaml` | `cb6fb9d7e6b4` | `cb6fb9d7e6b4` | совпадает |

`THIRD_PARTY.md`: 20 скопированных skills, `retro` в списке engineering, две строки в «Reference edits».
`harness-third-party-skills.test.ts`: `retro` в `UPSTREAM`, `EDITED`, `MANUAL_ONLY` (`true`), убран из `NOT_TAKEN`.
Проверка вызовов Skill tool теперь читает и форму `Skill tool with \`name\`` (так пишет `retro`), не только имя в кавычках.
`coverage.json`: обе строки `retro` — «No case yet: the cases of the copied skills come in a later change.»

### Test-ы

- Сначала красный (на старых hook-ах, test-ы уже новые): `session-hooks.test.sh` — exit 1, `FAIL retro_reminder_after:
  SessionEnd hooks (2, exit codes: 0 0) or a pending-retro.log was written`, `FAIL hooks/session-end.mjs is still there`,
  `FAIL suite repo: reminder from an old log`; `rules-hooks.test.sh` — exit 1 (`hooks.json differs`); contract — 10 красных:
  `harness-codex-hooks` (SessionEnd пишет лог), `codex-parity` строка 8, `harness-hook-stdin` (`FIRST_BYTE_MS`),
  `harness-third-party-skills` (`retro` не скопирован).
- Новые случаи: Profile с `session.retro_reminder_after` и без `inject_rules` — SessionStart пусто, exit 0; каждый
  `SessionEnd` из `hooks.json` — exit 0, `pending-retro.log` не создан (`session-hooks.test.sh`, Claude Code); то же под
  Codex (`harness-codex-hooks.test.ts`, `codex-parity.test.ts` строка 8); старый `pending-retro.log` из 3 строк не даёт
  напоминания и остаётся как был.
- `workflow-profile.test.ts`: Profile с полем — настоящий `bin/profile` (копия `harness/` в Harness home test-а) отвечает
  `--field session.retro_reminder_after` и `--json` с exit 0; `readResolvedProfile`, `readPipelineProfile`,
  `readMcpAllowlist`, `readGithubAccount` приложения читают его без ошибки; `bin/project-connect --schema-only` пропускает
  draft с полем (exit 0, `ok: true`) и ничего не пишет. Эти два случая зелёные и на `main`: поле там уже никто не
  проверял, test это закрепляет.

### Отступления от Ticket-а

- `docs/features/skills-agents-and-hooks.md` (английская страница) поправлен здесь, а не в Ticket-е 04: `pnpm lint`
  (`check-feature-docs`) красный, пока страница называет удалённые `session-end.mjs` и `harness-retro-skill.test.ts`.
  Поправлены только строки об удалённом: строка `retro` в таблице skills, test в «Main tests», строка `SessionEnd`
  `session-end.mjs`, список hook-ов, которые не ломают Session, строка напоминания, раздел «Implementation».
  Перевод `ru/` и `harness/README.md` — Ticket 04.
- `src/main/harness/migrate/plan.ts` (в Ticket-е — «только читать») поправлен: список `RETIRED_HOOKS = ['session-end.sh']`.
  Перенос старого Harness из `~/.claude` узнаёт файл Harness по одноимённому файлу plugin-а (`hooks/<имя>.sh` ↔
  `hooks/<имя>.mjs`). Без `session-end.mjs` в plugin-е перенос оставлял бы старый `~/.claude/hooks/session-end.sh` и его
  запись `SessionEnd` в `settings.json` — он и дальше писал бы `pending-retro.log` после переноса. Это поймали 4 случая
  `test/contract/harness-migrate.test.ts` (красные в полном `pnpm test`); с правкой они зелёные без изменений в test-е.
  Список `HARNESS_SKILLS` (`retro`) не тронут.
- `harness/profiles/README.md` пишет «removed; ignored if present» без «in worfy-skills 02»: test нейтральности plugin-а
  (`plugin-neutral.test.sh`, ADR-0074) запрещает номера Ticket-ов worfy в тексте `harness/`.

Файлы `state/pending-retro.log` на машинах не тронуты.
