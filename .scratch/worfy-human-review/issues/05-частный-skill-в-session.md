# 05 — Частный skill проекта в Session через `additionalDirectories`; ADR

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 8, 9, 11; «Как работает» → «Частная папка», «Загрузка в Session»; «Сгенерированное и решения без владельца», п. 4, 8; «Вопросы владельцу», Q1, Q2; «Риски», п. 1; [исследование](../../../docs/research/2026-11-07-human-review-из-истории-pr.md), раздел 9

Платформенный Ticket: путь папки Profile-а в опциях каждой Session на Mac и Windows — Windows verdict до merge
(ADR-0056). Глубина ревью — `high`: Ticket меняет опции каждой Session worfy; пробел в test-е «Session без человека не
получает папку» держит merge.

## Что происходит

- `sessionOptions` кладёт в `additionalDirectories` только папку карточек Canvas
  (`src/main/vendors/claude/options.ts:571`), и только когда Session привязана к Canvas.
- Session без человека (`unattended`, Autopilot) идёт с `bypassPermissions` (`options.ts:533`).
- `skills.allowed` выключает plugin-ы пользователя и skills `~/.claude/skills` по имени (`options.ts:402-409`,
  ADR-0084); список читает `readSkillsAllowlist` (`src/main/workflow/profile.ts:597`), вызов — `query.ts:141-163`.
- Папку Profile-а (`_resolved.dir`) приложение сейчас не читает; `readResolvedProfile` берёт `mode`,
  `workflow_folder`, `workspace`, `repos` (`profile.ts:728-750`).
- Что Claude Code грузит `.claude/skills/` из `--add-dir` / `additionalDirectories`, известно из документации, не из
  запуска (исследование, раздел 9, 11).

## Что делаем

1. **Сначала проверка.** На dev-сборке: временная папка с `.claude/skills/hr-probe/SKILL.md` в
   `additionalDirectories` Session-а — skill виден в списке slash-команд и вызывается. Результат и версия SDK — в
   «Итог». Не грузится — стоп, Ticket уходит в `blocked` с вопросом владельцу о Q1 (б).
2. Читать `_resolved.dir` Profile-а Project-а (одна функция в `profile.ts`, кэш как у списков).
3. Если `<_resolved.dir>/state/human-review/.claude/skills/human-review/SKILL.md` есть — папка
   `<_resolved.dir>/state/human-review/` добавляется в `additionalDirectories` после папки карточек (или одна, если
   Canvas нет). Только для Session-ов с человеком: не `unattended`; одноразовая Session черновика Profile-а
   (`projects.connect.draft`) — тоже нет.
4. ADR «Частные skills проекта в папке Profile-а»: где лежат, как попадают в Session, кто не получает, почему не
   репозиторий и не `~/.claude/skills`. Номер ADR берёт ship-ticket.

## Готово, когда

- [ ] «Итог» записывает живую проверку: skill из `additionalDirectories` виден и вызывается (или Ticket в `blocked`).
- [ ] Unit test: с файлом `SKILL.md` — папка в `additionalDirectories` рядом с папкой карточек; без файла — нет; без
      Canvas — одна папка.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/agent-options.test.ts test/contract/workflow-profile.test.ts` exit 0 · mac - · aefbb2dc5c1d5b46df5539b32bd0bd7cc08f192f
- [ ] Unit test: `unattended: true` — папки нет.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/agent-options.test.ts test/contract/workflow-profile.test.ts` exit 0 · mac - · aefbb2dc5c1d5b46df5539b32bd0bd7cc08f192f
- [ ] Unit test: `skills.allowed: []` — папка на месте, `skillOverrides` не называет `human-review`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/agent-options.test.ts test/contract/workflow-profile.test.ts` exit 0 · mac - · aefbb2dc5c1d5b46df5539b32bd0bd7cc08f192f
- [ ] Contract test: `_resolved.dir` читается; ошибка `bin/profile` — Session стартует без папки и с одной строкой в
      log.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/workflow-profile.test.ts` exit 0 · mac - · aefbb2dc5c1d5b46df5539b32bd0bd7cc08f192f
- [ ] ADR записан, ссылается на ADR-0084 и на этот spec.
  - evidence: commit pass · ADR-0102: name the private folder as a working directory of the Session · - - · aefbb2dc5c1d5b46df5539b32bd0bd7cc08f192f
- [ ] `ci-ok` на PR зелёный; Windows verdict есть.

## Тесты

- `test/unit/agent-options.test.ts` — опции; `test/contract/workflow-profile.test.ts` — чтение `_resolved.dir`.
- Сначала падающий: Session с человеком и файлом `SKILL.md` — красный, пока папки нет в опциях.
- Существующие: `test/contract/canvas-tools.test.ts`, `test/contract/browser-tools.test.ts` (папка карточек
  остаётся первой).

## Где в коде

- `src/main/vendors/claude/options.ts`
- `src/main/vendors/claude/query.ts`
- `src/main/workflow/profile.ts`
- `test/unit/agent-options.test.ts`
- `test/contract/workflow-profile.test.ts`
- `docs/adr/<NNNN>-private-project-skills-in-profile-folder.md` (новый)

## Итог

- **Живая проверка (шаг 1), Claude Code 2.1.289, SDK 0.3.289.** Бинарник Claude Code из `node_modules` запущен с
  временными `HOME` и `CLAUDE_CONFIG_DIR`, без входа в аккаунт: `--print --output-format stream-json --verbose`, во временной
  папке проекта. С `--add-dir "<tmp>/private dir"`, где лежит `.claude/skills/hr-probe/SKILL.md`, в `system/init` skill
  `hr-probe` есть в `skills` и в `slash_commands`. Без `--add-dir` его нет. С flag settings списка `skills.allowed: []`
  (`syncClaudeAiSkills: false`, `skillOverrides` для другого skill-а) он остаётся. Путь с пробелом работает. Опция SDK
  `additionalDirectories` — это `--add-dir` (`sdk.d.ts`). **Вызов skill-а не проверен.** Без входа ответ модели —
  «Not logged in», а вход с настоящим `~/.claude` записал бы транскрипт туда. Q1 (а) работает, запасной путь (б) не нужен.
- **Красный на старом поведении** (`origin/main` cfde888af): в `test/unit/agent-options.test.ts` 5 новых test-ов
  красные (папки нет в `additionalDirectories`). В `test/contract/workflow-profile.test.ts` красные 18: нет
  `readProfileFolder`, `PROFILE_DIR_FIELD` и `privateSkillsFolder`.
- **Папка Profile-а** читается через `bin/profile -C <cwd> --field _resolved.dir`, а не через `--dir` из Ticket-а 09. Это
  одно и то же значение. Читается при каждом старте Session в Project-е, как списки: отдельного кэша у списков нет. Путь
  частной папки и `SKILL.md` строятся функциями `privateFolder` и `reviewerSkill` из `src/main/projects/review-offer.ts`,
  поэтому папка та же, что у «Team reviewer».
- **Кто получает:** Session в Project-е, которую ведёт человек: Orchestrator, «New session», «Ship ticket» и Product
  Session. Product Session — Session с человеком, и spec её не исключает. Её guard ограничивает запись, а не чтение.
- **Кто не получает:**
  - `unattended`: папка Profile-а даже не читается, и `sessionOptions` её не добавляет;
  - Session черновика: `draftSessionOptions` ставит `privateSkills: null`;
  - Session без Canvas (вне Project-а или Canvas не подключился): здесь папка не читается, как и списки Profile-а.
  `sessionOptions` сам умеет «одна папка без Canvas», но `query.ts` до этого случая не доходит.
- **Log.** Ошибка `bin/profile` или не абсолютный путь дают одну строку `[profile] Profile folder of …`, и Session
  стартует без папки. Если Profile есть, а skill-а нет, строки нет.
- ADR — `docs/adr/0102-private-project-skills-in-profile-folder.md`. Страница Feature — `docs/features/projects.md`,
  «Team reviewer».
