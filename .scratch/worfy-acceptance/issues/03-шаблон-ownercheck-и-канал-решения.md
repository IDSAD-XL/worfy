# 03 — Шаблон действия `ownerCheck` и канал `actions.ownerCheck`: решение владельца уходит Orchestrator-у

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Ticket-ы», 3; «Решения по реализации» → «Решение — шаблон действия», ««Sent» — отправлено,
но ещё не записано», «Платформа, копия и commit строки»; «Вопросы владельцу», Q6

Кто: агент.

Не платформенный Ticket (`src/shared/`, `src/main/`, `src/renderer/shell/ProjectSettings.tsx`). Глубина ревью — `medium`.

## Что происходит

- Шаблоны действий Project-а — `ACTIONS`, `ACTION_LABELS`, `PLACEHOLDERS`, `PLUGIN_HARNESS_TEMPLATES`,
  `LEGACY_HARNESS_TEMPLATES` (`src/shared/projects/action-templates.ts`). Placeholders сегодня: `epic`, `NN`, `wave`,
  `slug`, `branch`, `tickets`, `repo`, `pr`, `sha`.
- Run wave уходит каналом `actions.runWave` (`src/shared/ipc/actions.ts`) в `ActionLauncher`
  (`src/main/actions/launch.ts`); пока идёт Autopilot — отказ `AUTOPILOT_RUNNING_HINT`.
- Поля шаблонов — в Project settings (`src/renderer/shell/ProjectSettings.tsx`); страница — `docs/features/projects.md`
  («Project settings…»).
- Хранилище «Sent» есть после Ticket-а 01 (`src/main/acceptance/sent-store.ts`).

## Что делаем

1. Действие `ownerCheck` с подписью «Record owner check»; placeholders `item`, `verdict` (`pass` или `fail`), `platform`,
   `copy`, `sha` (commit копии или `-`).
2. Шаблон по умолчанию с plugin-ом Harness: `/worfy:owner-check {epic} {NN} {item} {verdict} {platform} {copy} {sha}`.
   Со старым Harness — пустой: кнопки неактивны с причиной, как «Process gate queue» и «Draft replies».
3. Комментарий владельца — не placeholder: он идёт после команды абзацем «Owner's words:» цитатой. Значения placeholders
   проверяют схемы (как `githubRepoSchema`).
4. Канал `actions.ownerCheck` (`'project', 'write'`) рядом с `actions.runWave`: текст уходит Orchestrator-у Project-а в
   его очередь; пока идёт Autopilot — отказ с причиной (Q6 (а)). Успех пишет запись «Sent».
5. Поле шаблона в Project settings.
6. `docs/features/projects.md`: шаблон «Record owner check» в списке шаблонов.

## Готово, когда

- [ ] Unit test `test/unit/action-templates.test.ts`: render `ownerCheck` с новыми placeholders и абзацем «Owner's
      words:»; текст владельца не попадает внутрь команды; пустой шаблон при старом Harness. Красный до правки — в «Итог».
- [ ] Contract test (`test/contract/actions-owner-check.test.ts`, новый, образец `test/contract/actions.test.ts`):
      `actions.ownerCheck` кладёт текст в очередь fake Orchestrator-а (`WORFY_AGENT=fake`) и пишет «Sent»; при Autopilot —
      отказ с `AUTOPILOT_RUNNING_HINT`; неверный `verdict` отклоняет схема.
- [ ] `docs/features/projects.md` называет шаблон «Record owner check»; `node scripts/check-feature-docs.mjs` — exit 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/shared/projects/action-templates.ts`, `src/shared/ipc/actions.ts`, `src/main/ipc/actions.ts`,
  `src/main/actions/launch.ts`
- `src/renderer/shell/ProjectSettings.tsx`
- `src/main/acceptance/sent-store.ts` (Ticket 01)
- `test/unit/action-templates.test.ts`, `test/contract/actions-owner-check.test.ts` (новый)
- `docs/features/projects.md`

Только читать: `test/contract/actions.test.ts`, `src/main/agent/fake-query.ts`.

## Вне скоупа

- Skill, который пишет строку, — Ticket 04. Кнопки Pass и Fail — Ticket 05. Linked machine — Ticket 07.
