# 23 — worfy читает Workflow folder Silent Project-а; Project над несколькими репозиториями: репозиторий на Node Ticket-а, Gate, PR и CI по нему

Type: task
Status: done — 2026-10-09, [PR #178](https://github.com/IDSAD-XL/worfy/pull/178)
Branch: worfy-harness/23
Blocked by: 22
Source: решения владельца 2026-10-07, Q27, Q29, Q24, Q17; [ADR-0042](../../../docs/adr/0042-profile-on-machine-full-and-silent-modes.md) (Full mode и Silent mode, Workflow folder, статус в Silent только в Workflow folder); [ADR-0045](../../../docs/adr/0045-one-ticket-one-repository.md) (один Ticket — один репозиторий, Project над несколькими репозиториями — Silent mode); [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md) (worfy — вид над workflow, только чтение); [ADR-0005](../../../docs/adr/0005-worfy-own-state-inventory.md) (worfy ничего не пишет в репозитории Project-ов); [spec.md](../spec.md)

## Что происходит

- worfy ищет файлы Ticket-ов и spec только в `<корень Project-а>/.scratch`.
  - `epic-status --json` идёт с cwd корня Project-а (`src/main/workflow/reader.ts:66-80`) и сам
    находит корень Ticket-ов через Profile. Но заголовки Epic-ов и раздел «Где в коде» worfy
    дочитывает из `join(root, '.scratch')` (`src/main/workflow/reader.ts:151-183`, строка `:152`).
    У Silent Project-а там ничего нет: Epic-и без заголовков, Ticket-ы без файлов.
  - Слежение — `watch(join(root, '.scratch'))` (`src/main/workflow/watch.ts:167`) и refs веток
    (`src/main/workflow/watch.ts:169-179`). Правки в Workflow folder Canvas не обновляют.
  - Статус из ветки поверх checkout-а: worktree с веткой `<epic>/<NN>` читаются
    `epic-status --json --ref <ветка>` (`src/main/workflow/reader.ts:212-226`, `:247-282`,
    `:300-314`; ADR-0033). В Silent mode статус живёт только в Workflow folder (Q27), а `--ref`
    отвечает кодом 3 (Ticket 22).
- HANDOFF и ADR worfy читает только как `HANDOFF.md` в корне Project-а и `docs/adr/NNNN-*.md`
  (`src/main/docs/watch.ts:29-34`, `:84-107`); корень — `project.path`
  (`src/main/ipc/docs.ts:92`, `:105`, `:107`).
- Project — только git-репозиторий: папку вне git `ProjectStore.resolve` отвергает с «is not a git
  repository» (`src/main/projects/store.ts:192-206`). Atakama — папку над тремя репозиториями, саму
  не git — в worfy добавить нельзя.
- Бейджи Gate, PR и CI:
  - `checks.get` берёт один `root` и ветки Ticket-ов (`src/main/ipc/checks.ts:21-26`):
    `git worktree list` и `gh` идут в этом `root`. Папка над репозиториями — не репозиторий.
  - Ветку `checks.get` принимает, только если она вида `<epic>/<NN>`
    (`src/shared/ipc/checks.ts:20-23`). Ticket находит свой worktree и PR по такой ветке или по
    папке `.claude/worktrees/<NN>` (`src/shared/ipc/checks.ts:110-140`,
    `src/shared/workflow/ticket-ref.ts:22-41`). В Silent mode ветка — по смыслу, без номера (Q25), а
    дерево нового Project-а — `~/.claude/worfy-harness/worktrees/<project>/<NN>` (Q17, Ticket 22).
  - Опрос — по корню Project-а (`src/renderer/canvas/badges/use-checks.ts:35-52`, отбор веток —
    `:96-105`); бейджи Ticket-а и действие Open PR берут тот же корень
    (`src/renderer/canvas/badges/ChecksBadges.tsx:73-75`, `src/renderer/canvas/actions/OpenPr.tsx:22`).
- Binding по ветке и по папке worktree — те же `parseTicketBranch` и `parseWorktreeFolder`
  (`src/shared/binding/resolve.ts:177-191`): ветка без номера Ticket не называет.
- Node Ticket-а (`src/renderer/canvas/nodes/TicketNode.tsx`) репозиторий не показывает; в модели
  Ticket-а нет ни репозитория, ни ветки (`src/shared/workflow/types.ts:19-29`, `:45-55`).
- Ticket 22 (Silent mode в Harness) даёт: у `profile --json` — `_resolved.mode`,
  `_resolved.workflow_folder`, `_resolved.repos` (`[{name, path, gate_key}]`); у Ticket-ов в
  `epic-status --json` — поля `branch` (строка `Branch:`) и `repo` (строка `Repo:`); структуру папок
  Workflow folder как у Full mode (`.scratch/`, `HANDOFF.md`, `docs/adr/`); дерево вне репозитория
  `<HARNESS_HOME>/worktrees/<project>/<NN>`. Ticket 12 даёт путь скриптов Harness в папке plugin.

## Что делаем

1. **Где workflow Project-а.** worfy читает у Harness `profile -C <корень Project-а> --json` тем же
   запуском скрипта и с теми же кодами выхода, что `src/main/workflow/profile.ts`: `mode`,
   `workflow_folder`, `repos`. Корень Ticket-ов — `ticket root` с cwd корня Project-а: тот же расчёт,
   что у `epic-status`. Код 3, код 4, сбой скрипта или Harness без этих полей — как сейчас: Full
   mode, Workflow folder — корень Project-а, один репозиторий, корень Ticket-ов —
   `<корень>/.scratch`. Причина — одна строка в лог на Project.
2. **Ticket-ы и spec — из корня Ticket-ов.** `enrichSnapshot` читает spec Epic-ов и файлы Ticket-ов
   из корня, который назвал `ticket root`. Watcher следит за этим корнем; в Silent mode он лежит в
   Workflow folder, вне репозитория.
3. **Silent: без статуса из веток (Q27).** В Silent mode worfy не вызывает `epic-status --ref` и не
   следит за refs ради статуса: `fromBranch` всегда `null`, `branchErrors` пуст. Full mode — без
   изменений (ADR-0033).
4. **HANDOFF и ADR — из Workflow folder.** Корень документов: в Full mode — корень Project-а, в
   Silent mode — Workflow folder. Правило «только `HANDOFF.md` в корне и `docs/adr/NNNN-*.md`» то
   же, относительно этого корня (`docs.open`, `docs.read`, watcher документов).
5. **Project над несколькими репозиториями (Q29).**
   - Папку вне git worfy добавляет, если Harness её знает: `profile -C <папка>` — код 0 и
     `_resolved.workspace` не `null`. Незнакомая папка вне git — отказ, как сейчас; в тексте отказа
     — что Project над несколькими репозиториями сначала подключается в Harness (форма подключения
     — Ticket 24).
   - Node Ticket-а показывает его репозиторий — chip с именем из `repo`, когда у Project-а
     больше одного репозитория (`data-testid="ticket-repo"`, подсказка «repository <имя>»). Ticket
     без `Repo:` в таком Project-е — chip «no repo», бейджей Gate, PR и CI у него нет.
   - Gate, PR и CI Ticket-а — по его репозиторию. `checks.get` получает корень репозитория (путь
     из `_resolved.repos`) и ветки Ticket-ов этого репозитория; renderer опрашивает каждый
     репозиторий отдельно. main принимает только корень Project-а или один из его `repos`: `gh` и
     `git` не идут в произвольную папку. Аккаунт GitHub — тот же `github.account` Profile-а
     (Ticket `worfy-week/01`, бейджи от аккаунта Project-а).
6. **Ветка и дерево Ticket-а в Silent mode.**
   - Ветка Ticket-а — поле `branch` модели. По ней ищутся PR, CI и worktree Ticket-а.
   - `checks.get` принимает такую ветку, если модель называет её веткой Ticket-а этого Project-а;
     прежние ограничения остаются: без пробелов, не начинается с `-`, не длиннее 200 символов.
   - Дерево `<HARNESS_HOME>/worktrees/<project>/<NN>` узнаётся как дерево Ticket-а `<NN>`, наравне с
     `.claude/worktrees/<NN>`.
   - Binding по ветке: ветка, которую модель называет веткой Ticket-а, привязывает Session к этому
     Ticket-у; ветка `<epic>/<NN>` — как раньше.
7. **Только чтение.** worfy ничего не пишет в Workflow folder и в репозитории Project-а (ADR-0002,
   ADR-0005): ни файлов, ни `git fetch`, ни refs.

UI-тексты — по-английски (`docs/design/BRIEF.md`). ADR не нужен: решения — ADR-0042 и ADR-0045.

**Не входит:** форма подключения Project-а, выбор режима и Workflow folder, запись Profile
(Ticket 24); выбор аккаунта GitHub при подключении (Ticket 25); коллекции qmd (Ticket 17); Harness —
Ticket 22.

## Готово, когда

- [ ] Contract test `test/contract/workflow-reader.test.ts`: Silent Project — git-репозиторий без `.scratch` и Workflow folder во временной папке, подменённые `profile`, `ticket` и `epic-status`. Epic-и с заголовками из spec.md в Workflow folder, у Ticket-ов файлы из «Где в коде». `epic-status --ref` не вызывается, даже когда есть worktree с веткой `<epic>/<NN>`; `fromBranch` — `null`.
- [ ] Тот же test: Full Project и Harness без новых полей (код 4, нет `_resolved.mode`, сбой скрипта) — ответы как до Ticket-а.
- [ ] Тот же test: правка файла Ticket-а в Workflow folder приходит новой моделью через watcher.
- [ ] Contract test `test/contract/docs.test.ts`: в Silent mode HANDOFF и ADR читаются из Workflow folder; `docs.read` пути вне Workflow folder отказывает.
- [ ] Contract test `test/contract/projects.test.ts`: папка вне git, которую `profile` знает (код 0, `workspace` не `null`), добавляется; незнакомая папка вне git — отказ с подсказкой о подключении.
- [ ] Contract test `test/contract/github-prs.test.ts`: Ticket с `branch: "fix/x"` находит свои PR, CI и worktree (`pullOfTicket`, `worktreeOfTicket`); в Project-е над двумя репозиториями Ticket-ы разных репозиториев не берут чужих PR; `checks.get` отказывает корню, которого нет среди корня Project-а и его `repos`, и ветке, которую модель не называет веткой Ticket-а.
- [ ] Unit test `test/unit/checks-badges.test.tsx`: бейджи Ticket-а берутся из снимка его репозитория; у Ticket-а без `repo` в Project-е над двумя репозиториями бейджей нет.
- [ ] Unit test `test/unit/epic-canvas.test.tsx`: в Project-е над двумя репозиториями у Ticket-а chip `ticket-repo` с именем репозитория, у Ticket-а без `Repo:` — «no repo»; в Project-е с одним репозиторием chip-а нет.
- [ ] Unit test `test/unit/ticket-ref.test.ts`: `<HARNESS_HOME>/worktrees/<project>/05` — дерево Ticket-а 05; прежние формы — как раньше.
- [ ] Unit test `test/unit/binding.test.ts`: Session на ветке `fix/x`, которую модель называет веткой Ticket-а 05, привязана к нему; ветка, которую модель не называет, — не привязана.
- [ ] e2e `test/e2e/silent-project.spec.ts` (новый): (1) Silent Project — Canvas показывает рамку Epic-а с заголовком и Ticket-ы из Workflow folder, HANDOFF Node — из Workflow folder; (2) Project над двумя репозиториями — у Ticket-ов chip `ticket-repo` с именем репозитория, бейджи PR и CI — от подменённого `gh` (`WORFY_GH`) своего репозитория. После прогона Workflow folder и оба репозитория не изменились: тот же список файлов с mtime, тот же `git status --porcelain`, те же refs.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — код 0; локальный `gate full` под замком `/tmp/worfy-e2e.lock` (правила Profile worfy) — код 0 и вердикт «зелено».
- [ ] (вручную) Stable copy после влития: Project Atakama (папка над тремя репозиториями, Workflow folder — она сама) добавляется и показывает свои Epic-и. Только чтение: в `/Users/alexey/Work/*` ничего не писать, `git fetch` не делать. Как проверить: окно приложения.

Ручной пункт агент проверяет, только если может посмотреть окно Stable copy. Если не может —
«не проверено: …» в «Итог» и пункт в HANDOFF, раздел «Ждёт владельца».

## Тесты

Сначала падающий test — `test/contract/workflow-reader.test.ts`, случай «Silent Project: заголовок
Epic-а из spec.md в Workflow folder». На нынешнем main `enrichSnapshot` читает
`<корень>/.scratch/<epic>/spec.md`, и заголовок — `null`: test падает. В «Итог» — как он падал.

- `test/contract/workflow-reader.test.ts` — Silent Project, Full Project, старый Harness, watcher.
- `test/contract/workflow-profile.test.ts` — чтение `_resolved.mode`, `workflow_folder`, `repos` по
  исходам `profile`: код 0, 3, 4, сбой, нет полей.
- `test/contract/docs.test.ts` — документы из Workflow folder.
- `test/contract/projects.test.ts` — папка над репозиториями.
- `test/contract/github-prs.test.ts` — ветка Ticket-а без номера, `checks.get` по репозиторию.
- `test/unit/checks-badges.test.tsx`, `test/unit/epic-canvas.test.tsx`, `test/unit/ticket-ref.test.ts`,
  `test/unit/binding.test.ts` — бейджи и chip репозитория, дерево и Binding Ticket-а.
- `test/e2e/silent-project.spec.ts` — новый. Подменённые скрипты Harness кладёт туда, где их ищет
  worfy после Ticket-а 12, как это делают нынешние e2e (`test/e2e/checks-badges.spec.ts:153`).

## Где в коде

- `src/main/workflow/profile.ts`
- `src/main/workflow/folder.ts` — новый: режим, Workflow folder, корень Ticket-ов и репозитории Project-а
- `src/main/workflow/reader.ts`
- `src/main/workflow/watch.ts`
- `src/main/docs/watch.ts`
- `src/main/ipc/docs.ts`
- `src/main/projects/store.ts`
- `src/main/ipc/checks.ts`
- `src/shared/ipc/checks.ts`
- `src/shared/workflow/types.ts`
- `src/shared/workflow/ticket-ref.ts`
- `src/shared/binding/resolve.ts`
- `src/renderer/canvas/badges/use-checks.ts`
- `src/renderer/canvas/badges/ChecksBadges.tsx`
- `src/renderer/canvas/actions/OpenPr.tsx`
- `src/renderer/canvas/nodes/TicketNode.tsx`
- `test/contract/workflow-reader.test.ts`
- `test/contract/workflow-profile.test.ts`
- `test/contract/docs.test.ts`
- `test/contract/projects.test.ts`
- `test/contract/github-prs.test.ts`
- `test/unit/checks-badges.test.tsx`
- `test/unit/epic-canvas.test.tsx`
- `test/unit/ticket-ref.test.ts`
- `test/unit/binding.test.ts`
- `test/e2e/silent-project.spec.ts` — новый

Файлы Harness этот Ticket не меняет — их меняет Ticket 22. `src/main/projects/store.ts` и
`test/contract/projects.test.ts` — только у этого Ticket-а. Ticket 24 (подключение Project-а) их не
трогает, строит диалог поверх правила пункта 5 и может идти в той же Wave (spec.md, Wave 11).

## Итог

- Где workflow Project-а — новый `src/main/workflow/folder.ts`: `readProjectLayout` спрашивает
  `profile -C <корень> --json` (`readResolvedProfile` в `src/main/workflow/profile.ts`, тот же запуск и
  те же коды выхода, что у `mcp.allowed`) и `ticket root` в корне Project-а. Код 3, код 4, нет скрипта,
  сбой, не JSON, нет `_resolved.mode` — Full mode, корень Project-а, `<корень>/.scratch`, репозиториев
  не названо; причина — одна строка `[workflow] …` в лог на Project. Сбой одного `ticket root` —
  `<Workflow folder>/.scratch`. `LayoutCache` держит ответ 30 с (checks и документы спрашивают часто).
- `enrichSnapshot` и watcher читают корень Ticket-ов, который назвал `ticket root`; в Silent mode
  `epic-status --ref` не вызывается и refs не отслеживаются, `fromBranch` — `null`, `branchErrors` пуст.
  Режим читается один раз при старте watcher-а: смена режима в Profile видна после повторного
  открытия Project-а. У Ticket-а в модели — `branch` и `repo` из `epic-status --json` (необязательные:
  старый Harness их не даёт).
- HANDOFF и ADR: корень документов — `docsRoot` в `src/main/ipc/docs.ts` (Full — корень Project-а,
  Silent — Workflow folder); правило `resolveDocPath` то же.
- Папка вне git добавляется, если `profile -C <папка> --json` даёт `_resolved.workspace`; корень Project-а —
  этот workspace (папка внутри него добавляет его же, с пояснением). Отказ теперь: «… is not a git
  repository. Choose the folder of a git repository; a Project over several repositories is connected in
  the Harness first.»
- Gate, PR и CI: новый канал `checks.repos` (`project`, как `checks.get`: Canvas Linked machine
  показывает те же бейджи) — режим и репозитории Project-а. Renderer (`use-checks.ts`) в Project-е над
  несколькими репозиториями спрашивает `checks.get` по каждому репозиторию с ветками его Ticket-ов;
  бейджи и Open PR Ticket-а — из снимка его репозитория, Ticket без `Repo:` — без бейджей.
  `checks.get` в main принимает только корень Project-а или один из его `repos` (из окна тоже) и ветки
  `<epic>/<NN>` или названные моделью (`Branch:`) для Ticket-ов этого репозитория; модель — из
  `WorkflowHub.model`.
- Дерево `<HARNESS_HOME>/worktrees/<project>/<NN>` узнаётся как дерево Ticket-а `<NN>` (`ticket-ref.ts`,
  Binding по cwd); Binding по ветке сначала ищет Ticket, чей `Branch:` — эта ветка (ровно один).
- Chip репозитория на Node Ticket-а (`data-testid="ticket-repo"`, подсказка «repository <имя>», «no repo»
  без `Repo:`) — только когда у Project-а больше одного репозитория. Снимки:
  [Silent Project, светлая](../evidence/23-silent-project-light.png),
  [тёмная](../evidence/23-silent-project-dark.png); [два репозитория, светлая](../evidence/23-two-repos-light.png),
  [тёмная](../evidence/23-two-repos-dark.png).
- Как падал первый test: `test/contract/workflow-reader.test.ts`, «Silent Project: …» — на main
  `model.epics[0].title` был `null` (ожидался «Silent epic: tickets outside the repository»): spec.md
  читался из `<корень>/.scratch`.
- Вне следа (требовал результат Ticket-а): `test/contract/link-access.test.ts` — вызов `checks.get` из окна
  с корнем вне Project-ов теперь отказ (раньше проходил); `test/e2e/projects.spec.ts` (след Ticket-а 24) —
  новый текст отказа для папки вне git.
- Решено без владельца, подтвердить: (1) дерево вне репозитория узнаётся по любому
  `…/worktrees/<project>/<NN>`, а не только под `HARNESS_HOME`: путь Harness home renderer не знает, а его
  можно перенести; (2) окружение `profile` и `ticket` для чтения режима — то же, что у `epic-status`
  (окружение процесса worfy); (3) `checks.get` отказывает всему вызову при чужой ветке — renderer
  отправляет только ветки, которые main примет; (4) список репозиториев renderer спрашивает один раз за
  жизнь окна.
- Долг Ticket-а 22 (`src/main/workflow/reader.ts:321` читает `done` с невлитой ветки как закрытый) не
  исправлен: это правило ADR-0033 («ветка перекрывает checkout, кроме `blocked`/`done` checkout-а»), его
  изменение — отдельное решение; в Silent mode ветки не читаются вовсе, там долга нет.
- Проверки: `pnpm lint && pnpm typecheck && pnpm test` — код 0 (157 файлов, 3060 test-ов); gate fast — код 0,
  «зелено»; `GATE_SCOPE=all gate.sh full` под замком `/tmp/worfy-e2e.lock` — код 0, «зелено (full)» (третий
  прогон: в первом упали оба test-а `silent-project.spec.ts`, во втором — 25 test-ов `agent…card-runtime`,
  оба раза при параллельных прогонах e2e других агентов: замок снимался как «старше 30 минут» у
  ещё работавшего владельца; отдельно `silent-project.spec.ts` проходил).
- Не проверено: ручной пункт — Project Atakama в Stable copy (окно Stable copy агенту недоступно,
  `/Users/alexey/Work/*` не читались). Двойной клик по Ticket-у Silent Project-а открывает путь
  `.scratch/…` относительно корня Project-а (`ticketFile` в `src/renderer/canvas/epic-layout.ts`, вне
  следа) — файла там нет. Бейдж Gate на Session в Project-е над несколькими репозиториями по-прежнему
  спрашивает корень Project-а (папку вне git) — Gate Session-а в таком Project-е не показывается.

### Gate оркестратора (2026-10-09)

- Круг 1 — `VERIFIED` ([комментарий в PR #178](https://github.com/IDSAD-XL/worfy/pull/178#issuecomment-6074833751)), с долгами:
  - [med] `src/main/ipc/checks.ts:69-70`, `:102-104` — `targetOf` ищет папку сначала среди корней Project-ов, потом среди репозиториев. Если репозиторий Project-а над несколькими репозиториями добавлен ещё и отдельным Project-ом (его workflow не открыт), `checks.get` по этому репозиторию с веткой из строки `Branch:` (`fix/x`) отказывает, и у Ticket-ов нет бейджей Gate, PR, CI; renderer ключует снимки по пути (`use-checks.ts:166-176`), два Project-а делят ключ. Исправление: передавать в `checks.get` корень спрашивающего Project-а.
  - [low] `test/contract/github-prs.test.ts:861-868` — test «without running gh or git» записывает только вызовы `gh`, не `git` (runner `worktrees`).
  - [low] ссылка в «Итог» на `reader.ts:321` взята с базы; на ветке `branchOverrides` — `:329`.
  - [low] `docs/design/F-SPEC.md` не описывает плашку репозитория на Node Ticket-а.
- Мерж: rebase на `f516c56`, `GATE_SCOPE=all gate full` — код 0 со второго прогона: в первом оба test-а `silent-project.spec.ts` не дождались рамки Epic-а за 5 s (load average 4.9). Исправлено отдельным PR #181: первое ожидание — 15 s. CI зелёный, CLEAN, влит `e42f732`.
