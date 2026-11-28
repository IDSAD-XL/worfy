# 09: Ветка worfy-Autopilot: проект Harness с локальным finish, Ticket, `/worfy:epic-wave`

Type: task
Status: open
Blocked by: 08
Source: [spec.md](../spec.md), «Ticket-ы», 09; «Решения владельца», «Задачи пилота» (Q17: worfy в обычной работе и в
Autopilot; Q19: две ветки worfy); «Решения по реализации» («Ветки пилота», worfy Autopilot; «Отбор» — правило 15 USD);
«Риски» (Autopilot-ветка может оказаться дорогой); «Волны», Wave 3

Кто: агент. Глубина ревью — `medium`.

Бесплатно: stub `claude` и stub container-а, как в Ticket-е 08. Цену ветки меряет отбор (Ticket 11).

## Что происходит

- Runner Ticket-а 08 гоняет worfy в обычной работе и Claude Code без plugin-а. Внешний читатель хочет видеть отдельно,
  что даёт сам plugin и что даёт конвейер Autopilot: implementer, reviewer-ы и gate.
- Autopilot шлёт команду `/worfy:epic-wave tickets <NN> of epic <epic>` (skill `harness/skills/epic-wave/`). Ему нужен
  проект Harness: Profile с `workflow.finish`, папка Ticket-ов, команда test-ов.

## Что строить

- В container-е ветки runner регистрирует репозиторий задачи как проект Harness: Profile с локальным finish
  (`local-green`) и командой test-ов задачи; папка состояния Harness — внутри container-а.
- Задача приходит Ticket-ом `.scratch/<eval>/issues/01-*.md` (текст Ticket-а — из prompt-а задачи, Ticket 10), команда
  — та же, что шлёт Autopilot: `/worfy:epic-wave tickets 01 of epic <eval>`. Никто не отвечает на вопросы.
- Запись run-а этой ветки — та же, что у остальных (Ticket 08), плюс вызванные subagent-ы и стоимость каждого.
- Правило отбора: если медиана цены run-а Autopilot-ветки на отборе выше 15 USD по ценам API, ветка идёт на половине
  задач, поровну из каждого семейства. Функция выбора задач — здесь, решение — в Ticket-е 11.
- Profile проекта задачи не попадает в `~/.claude/worfy-harness/` машины: только в container.

## Где в коде

- `scripts/eval-pilot/` (Ticket 08) — ветка Autopilot
- `harness/bin/project-connect`, `harness/bin/profile` — только вызов: регистрация проекта задачи
- `harness/skills/epic-wave/SKILL.md` — только читать: команда Autopilot
- `test/contract/eval-pilot.test.ts` — test-ы ветки

## Test-ы

- Contract test-ы со stub-ом `claude` и container-а: ветка получает команду `/worfy:epic-wave tickets 01 of epic <eval>`,
  Profile с `local-green` и командой test-ов задачи; Profile и состояние Harness — только в папке container-а; правило
  15 USD выбирает половину задач поровну из семейств.
- Сначала падающий test: ветка Autopilot отсутствует в плане `--dry-run`.
- Без моделей в CI; настоящий binary Codex не запускается.

## Готово, когда

- [ ] Ветка worfy-Autopilot в runner-е: проект Harness с локальным finish в container-е, Ticket, команда Autopilot.
- [ ] Правило 15 USD — чистая функция с test-ами.
- [ ] `--dry-run` показывает ветку в плане.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
