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
- [ ] Unit test: `unattended: true` — папки нет.
- [ ] Unit test: `skills.allowed: []` — папка на месте, `skillOverrides` не называет `human-review`.
- [ ] Contract test: `_resolved.dir` читается; ошибка `bin/profile` — Session стартует без папки и с одной строкой в
      log.
- [ ] ADR записан, ссылается на ADR-0084 и на этот spec.
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
