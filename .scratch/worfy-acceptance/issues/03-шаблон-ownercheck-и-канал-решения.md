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
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/action-templates.test.ts` exit 0 · mac - · a971bdc766fafe7f397c8f4d5a3690ec9d2ab419
- [ ] Contract test (`test/contract/actions-owner-check.test.ts`, новый, образец `test/contract/actions.test.ts`):
      `actions.ownerCheck` кладёт текст в очередь fake Orchestrator-а (`WORFY_AGENT=fake`) и пишет «Sent»; при Autopilot —
      отказ с `OWNER_CHECK_AUTOPILOT_HINT`, своей причиной: общая `AUTOPILOT_RUNNING_HINT` говорит «run a Wave by hand» (решено
      без владельца, подтвердить); неверный `verdict` отклоняет схема.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/actions-owner-check.test.ts` exit 0 · mac - · a971bdc766fafe7f397c8f4d5a3690ec9d2ab419
- [ ] `docs/features/projects.md` называет шаблон «Record owner check»; `node scripts/check-feature-docs.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs` exit 0 · mac - · a971bdc766fafe7f397c8f4d5a3690ec9d2ab419
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: test-run pass · `pnpm lint && pnpm typecheck` exit 0 · mac - · a971bdc766fafe7f397c8f4d5a3690ec9d2ab419
  - evidence: gate pass · `gate fast` exit 0 · mac - · a971bdc766fafe7f397c8f4d5a3690ec9d2ab419

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

## Итог

- Красный до правки: `node scripts/vitest-electron.mjs test/unit/action-templates.test.ts` — exit 1, 16 test-ов
  красные: шаблоны по умолчанию без `ownerCheck`, нет `ownerCheckState` и `ownerWordsParagraph`.
- Действие `ownerCheck` («Record owner check»), placeholders `{item}`, `{verdict}`, `{platform}`, `{copy}`; `{sha}` в этом
  действии — 7–40 hex-символов или `-`. Слова владельца — абзац «Owner's words:» цитатой после команды.
- Канал `actions.ownerCheck` (`'project', 'write'`): схема проверяет каждое слово skill-а, текст уходит Orchestrator-у
  (в очередь, пока идёт ход), «Sent» пишет служба Acceptance до отправки; при Autopilot — отказ с причиной.
- Поле шаблона в Project settings появилось без правки `src/renderer/shell/ProjectSettings.tsx`: диалог рисует поля по
  списку `ACTIONS`.
- Mutants по одному на поведение (7) в копии под `mktemp -d`: каждый красный на своём test-е — слова без цитаты, слова
  в команде, нет отказа при Autopilot, нет «Sent», текст уходит до проверки пункта, `verdict` любой строкой, `{sha}` только
  40 hex-символов.
- Решено без владельца: причина отказа при Autopilot — своя `OWNER_CHECK_AUTOPILOT_HINT` («Autopilot is running in this
  Project: stop it to record an owner check»), а не `AUTOPILOT_RUNNING_HINT` (её текст про Wave), как у «Process gate
  queue» и действий над PR; без слов абзац — один заголовок «Owner's words:»; предел слов — 10 000 символов; правка вне «Где в коде» —
  `src/shared/actions/render-template.ts` (render и проверка `{sha}`) и заглушки `ownerCheck` в fake launcher-ах
  `test/contract/actions.test.ts` (иначе typecheck красный).
- Раунд 2 ревью PR #2157: пункт сначала проверяет служба Acceptance (`checkDecision`: ручной, ждёт владельца, текст тот,
  что видел владелец), Autopilot спрашивается ещё раз прямо перед отправкой, «Sent» пишется только после удачного
  `send` — Session, закрытая между проверкой и отправкой, даёт ошибку и не оставляет «Sent». Решено без владельца: решение
  несёт текст пункта (`itemText`, его уже показывает строка очереди), а не hash — в строке очереди hash нет, а
  `itemTextHash` считает `node:crypto` и в renderer недоступен; поле обязательное.
- Заметка для Ticket-а 05: второе решение по тому же пункту, пока первое ждёт в очереди Orchestrator-а, тоже уходит —
  оба доходят до Orchestrator-а; UI должен не давать второе нажатие, пока пункт «Sent».
