# 04 — Вкладка Pipeline (доска активного Project-а) и секция Pipeline боковой панели

Type: task
Status: done 2026-10-18T03:03Z
PR: #467
Blocked by: 03
Source: решение владельца 2026-10-17, grilling о Pipeline, пункты 1, 2 ([spec.md](../spec.md),
«Решения владельца»); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md).

## Что происходит

- **Вид окна — два:** `ShellView = 'canvas' | 'session'` (`src/renderer/shell/Toolbar.tsx:11`),
  переключатель — `viewOptions` (`:19-41`). `AppShell` получает содержимое видов свойствами `canvas` и
  `session` (`src/renderer/shell/AppShell.tsx:13-22`, `:55`); вид задаёт `src/renderer/main.tsx`.
- **Секции боковой панели** — файлы `src/renderer/shell/sidebar/<Name>Section.tsx` с `order`,
  подхватываются сами (`src/renderer/shell/Sidebar.tsx:3-8`), рамка — `SidebarSection.tsx`. Пример —
  `EpicsSection.tsx` (Epic-и активного Project-а).
- После Ticket-а 03 Stage каждого Ticket-а приходит доменом `pipeline` (`pipeline.get`,
  `pipeline.changed`), хук — `src/renderer/pipeline/usePipeline.ts`.

## Что делаем

1. **Третья вкладка `Pipeline`** в `viewOptions` после Canvas и Session; `ShellView` +=
   `'pipeline'`; `AppShell` получает свойство `pipeline` с содержимым вида.
2. **Доска `src/renderer/pipeline/PipelineBoard.tsx`** — активный Project:
   - колонки — Stage его Pipeline по порядку, с `label` из Profile-а;
   - карточка — Ticket: `<epic> NN`, заголовок, «кого ждёт» (`owner`, `team`, `agent`, имя
     Machine), пометки `blocked` с причиной, `rework`, подпись Stage (`failing`, `gate running`,
     `waiting for gate`);
   - Queued — открытые и не начатые Ticket-ы; Done — свёрнут в счётчик, клик разворачивает;
   - клик по карточке — Card Ticket-а на Canvas (как фокус Epic-а из `EpicsSection`);
   - обновление живое: событие `pipeline.changed`, без кнопки обновления.
3. **Секция `src/renderer/shell/sidebar/PipelineSection.tsx`** — все Project-ы: Ticket-ы в работе
   (не Queued, не Done) с чипом Stage и «кого ждёт»; клик — вкладка Pipeline этого Project-а.
   Сворачивается, как другие секции (`SidebarSection`); пустая — строка «Nothing in work».
4. Надписи интерфейса — английские. Stage не хранится в renderer дольше окна (ADR-0002).

Не входит: выделение застрявших (06), stepper на Card (05).

## Готово, когда

- [x] `pnpm test test/unit/pipeline-board.test.tsx` — exit 0: колонки по Pipeline worfy и Atakama из
      spec-а; Done свёрнут в счётчик; `blocked`, `rework`, «кого ждёт» видны; секция показывает только
      Ticket-ы в работе.
- [x] `pnpm test:e2e test/e2e/pipeline.spec.ts` — exit 0: переключатель Canvas / Session / Pipeline;
      правка файла Ticket-а (`claim`) двигает карточку из Queued в Implementing без перезагрузки; клик по
      строке секции открывает доску.
- [x] `pnpm test:e2e test/e2e/sidebar-sections.spec.ts` — exit 0 (новая секция не ломает порядок).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.
- [ ] (вручную) Stable copy после мержа: доска worfy во время Wave — снимок в `../evidence/04-доска.png`.

## Тесты

Сначала падающий `test/unit/pipeline-board.test.tsx` на снимке `pipeline.get` из фикстуры. e2e — с
fake-агентом (`WORFY_AGENT=fake`, `test/e2e/helpers.ts`) и stub-ом `gh`; `test/e2e/helpers.ts` этот
Ticket не правит.

## Где в коде

- `src/renderer/shell/Toolbar.tsx`
- `src/renderer/shell/AppShell.tsx`
- `src/renderer/main.tsx`
- `src/renderer/pipeline/PipelineBoard.tsx` (новый)
- `src/renderer/pipeline/pipeline.css` (новый)
- `src/renderer/shell/sidebar/PipelineSection.tsx` (новый)
- `test/unit/pipeline-board.test.tsx` (новый)
- `test/e2e/pipeline.spec.ts` (новый)

## Итог

Сделано (implementer, 2026-10-18):

- Третья вкладка `Pipeline` в переключателе View (`Toolbar.tsx`), `ShellView` += `'pipeline'`, у
  `AppShell` новое свойство `pipeline`. Вид, как Canvas и Session, остаётся смонтированным и только
  скрыт. Содержимое задаёт `main.tsx`: `<PipelineBoard project={active} />`.
- Доска `src/renderer/pipeline/PipelineBoard.tsx`. Колонки — Stage снимка `pipeline.get` по порядку,
  с `title` из main (`label` Profile-а, иначе имя каталога). Карточка показывает `<epic> NN`, заголовок
  из модели workflow, `Waits: …`, `Blocked: <причина>`, `Rework` и подпись Stage (`failing`,
  `gate running`, `waiting for gate`, `gate busy`). Done свёрнут в кнопку «N done» (`aria-expanded`),
  клик разворачивает. Клик по карточке — вид Canvas и `focusCanvasNode` на Card Ticket-а, с рамкой
  Epic-а как запасной целью: так же делает «Go to» палитры, а не `focusEpic` (тот центрирует только
  рамку). Обновление живое: `usePipeline` и `pipeline.changed`, без кнопки. Пока снимка нет — «Reading
  the Pipeline…»; ошибка `pipeline.get` — строка с причиной; `snapshot.error` — заметка над колонками.
- Секция `src/renderer/shell/sidebar/PipelineSection.tsx`, `order = 25` (между Epics и Sessions).
  Показывает все Project-ы Machine окна: под именем Project-а — Ticket-ы, которые не Queued и не Done.
  Строка в две линии: `<epic> NN` и заголовок, затем чип Stage (`blocked` — красный, иначе `working`)
  и `Waits: …`. Клик: Project активен — сразу вкладка Pipeline; иначе сначала `openProject`, отказ —
  notice секции. Пустая — «Nothing in work». Сворачивается рамкой `SidebarSection`.
- Stepper тикета 05 не используется: на доске своего stepper-а нет, Stage виден колонкой.
- Stage в renderer живёт только в store `usePipeline`, пока смонтирован вид (ADR-0002).

Вне «Где в коде», с разрешения Orchestrator-а 2026-10-18:

- `test/e2e/sidebar-sections.spec.ts:23` — в `SECTIONS` добавлена `PipelineSection`: test сверяет
  список секций строго. Test-ы высот этого файла зелёные без правок.
- `src/renderer/theme/primitives.tsx` (SegmentedControl) и `src/renderer/shell/shell.css`. С третьим
  сегментом toolbar при окне 1280 px и длинном имени Project-а не помещался: `test/e2e/toolbar.spec.ts:125`,
  поле Search выходило за окно на 74 px. Теперь label сегмента обёрнут в `.w-segmented__label`,
  у кнопки есть `aria-label` и `title` с тем же текстом, поэтому доступное имя не изменилось. В окне уже
  1400 px переключатель View показывает только иконки; правило ограничено `.w-toolbar`, остальные
  SegmentedControl (`MigrationForm`) остаются с подписями. Порог `toolbar.spec.ts` не тронут.
- `src/renderer/pipeline/board.ts` (новый) — общие функции доски и секции. ESLint
  `react-refresh/only-export-components` не даёт экспортировать их из `PipelineBoard.tsx`.

- `src/main/workflow/stages.ts` и `test/contract/workflow-stages.test.ts` — после красного gate full
  перед merge, с разрешения Orchestrator-а. Секция Pipeline включила вычисление Stage для каждого
  Project-а. Если Profile не прочитан (`repos: []`), Stage-и читали PR в корне Project-а. У Project-а из
  нескольких репозиториев (Atakama) корень — обычная папка, и `gh` запускался вне репозитория
  (`test/e2e/silent-project.spec.ts:302`). В stub-е этого e2e у `_resolved` нет `name`, поэтому
  `readPipelineProfile` отказывает. Теперь корень берётся, только если он внутри git work tree
  (`rev-parse --is-inside-work-tree`). Два contract test-а: плоская папка над репозиториями — `gh`
  нигде (краснеет на mutant-е без проверки); корень-репозиторий — `gh` в корне, как раньше.

Проверено:

- `pnpm test test/unit/pipeline-board.test.tsx` — exit 0, 13 test-ов. Снимки строятся через
  `stageOf` и `stageLabel` для Pipeline worfy и Atakama из spec-а. Mutation testing: test-ы краснеют без
  фильтра «в работе», без свёртки Done, без пометки `rework` и без фокуса Card.
- e2e под замком: `pipeline.spec.ts`, `sidebar-sections.spec.ts`, `toolbar.spec.ts`, `focus-sidebar.spec.ts`,
  `session-back.spec.ts`, `harness-migrate.spec.ts`, `checks-badges.spec.ts` — 18 passed, exit 0.
- `pnpm lint`, `pnpm typecheck` — exit 0. `pnpm test`: один сбой по времени в
  `test/contract/harness-scripts.test.ts` (wave-gate.test.sh, ETIMEDOUT под нагрузкой). Повтор файла
  отдельно — exit 0. gate fast — exit 0, «[gate] зелено».
- Снимки (scratchpad, не в репозитории): доска и секция в светлой и тёмной теме, toolbar на 1280 и
  1600 px в обеих темах.

Не входит и осталось:

- Секция показывает Project-ы Machine окна (`useProjects`), без Project-ов Linked machine.
- В палитре нет команды «Switch to Pipeline»: `viewCommands` (`src/renderer/palette/commands.ts:195`)
  перечисляет только Canvas и Session. Файл вне списка — кандидат в следующий Ticket.
- (вручную) снимок доски worfy во время Wave — после мержа, на Stable copy.

Ревью и merge (2026-10-18): гейт глубины low — `VERIFIED` с первого круга
([вердикт](https://github.com/IDSAD-XL/worfy/pull/467#issuecomment-6244603788)). Проверяющий снял доску, секцию,
toolbar на 1280 и 1600 px и MigrationForm в обеих темах; e2e pipeline, sidebar-sections, binding, canvas-layout,
harness-migrate, terminal — 23 passed. Находка «клик по карточке не показывает скрытую Card» отклонена: палитра для
Card Ticket-а сама передаёт `hidden: false` (`src/renderer/palette/commands.ts:325`, `:388`).

Первый `GATE_SCOPE=all` gate full (head `d17a3966`) — красный: e2e `test/e2e/silent-project.spec.ts:302` увидел `gh`
в корне Project-а из двух репозиториев, 24 падения `spawnSync bash EAGAIN` в `harness-scripts.test.ts` — нагрузка
(файл отдельно — 37 passed). Правка до merge — абзац выше; проверка правки — `VERIFIED`
([вердикт](https://github.com/IDSAD-XL/worfy/pull/467#issuecomment-6244880213)). Второй gate full — зелёный; влит —
`e074b41f`. Долги:
- [low] `test/e2e/pipeline.spec.ts:161-164` — e2e проверяет только переход на Canvas после клика по карточке, не
  центрирование Card (разовый e2e проверяющего его подтвердил).
- [low] `test/e2e/silent-project.spec.ts:203`, `:252` — у stub-а Harness в `_resolved` нет `name`, поэтому оба e2e
  Silent-Project-а идут по пути «Profile не прочитан»: Pipeline из Profile, Silent marks и `several=true` там не
  проверяются. Исправление — добавить `name` в оба `resolved`.
- [low] `src/main/workflow/stages.ts:41` — `git rev-parse` с timeout 10 s: при timeout Ticket-ы в работе на один
  опрос теряют факты PR, а `snapshot.error` молчит.

Batch CI run на main — зелёный: https://github.com/IDSAD-XL/worfy/actions/runs/39092198641.
