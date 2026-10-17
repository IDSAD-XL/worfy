# 24 — Подключение Project-а: папка, режим, черновик Profile, форма, запись на машину и регистрация в Gate

Type: task
Status: done 2026-10-09
PR: #176
Blocked by: 19, 22
Source: решения владельца 2026-10-07, вопросы Q10, Q11', Q16, Q17, Q23–Q29; [spec.md](../spec.md); [ADR-0042](../../../docs/adr/0042-profile-on-machine-full-and-silent-modes.md) — Profile целиком на машине, Full mode и Silent mode, Workflow folder, worktree новых Project-ов вне репозитория; [ADR-0045](../../../docs/adr/0045-one-ticket-one-repository.md) — Project над несколькими репозиториями всегда в Silent mode; [ADR-0040](../../../docs/adr/0040-harness-delivery-local-marketplace.md) — состояние Harness в `~/.claude/worfy-harness/`; [ADR-0043](../../../docs/adr/0043-qmd-is-part-of-harness.md) — коллекции qmd по Profile; [ADR-0018](../../../docs/adr/0018-project-is-a-workflow-folder.md) — Project — папка с workflow; [docs/roadmap.md](../../../docs/roadmap.md), раздел E3

## Что происходит

- «Add project» сразу добавляет папку в список: `addProject` вызывает `projects.pickFolder`, потом
  `projects.add` (`src/renderer/shell/sidebar/ProjectsSection.tsx:120-130`). Диалог выбора просит
  «Choose the folder of a git repository» (`src/main/ipc/projects.ts:37`).
- `ProjectStore.resolve` принимает только git-репозиторий (`src/main/projects/store.ts:192-217`):
  подпапка и linked worktree сводятся к корню (`:208-215`), папка вне git — отказ «is not a git
  repository» (`:204`). Папку над несколькими репозиториями, как Atakama (ADR-0018), добавить нельзя.
- `add` пишет только `projects.json` и папку данных worfy (`:220-236`). Profile, Harness и аккаунт
  GitHub не проверяются.
- Profile worfy только читает, скриптом `bin/profile -C <корень> --field …`
  (`src/main/workflow/profile.ts:4-11`). У нового Project-а скрипт отвечает кодом 3 («папка вне
  зарегистрированных Project-ов»), и worfy берёт значения по умолчанию (`:110`).
- Новый Project в Harness заводят руками: четыре шага раздела «Новый проект» контракта Profile
  (`~/.claude/profiles/README.md:194-199`, после Ticket-а 02 — `harness/profiles/README.md`) — запись
  в реестр Gate, `profile.json`, `rules.md`, проверка `profile -C`. Ни скрипта, ни skill для этого нет.
- Project без Epic-ов: в боковой панели «No epics in .scratch/»
  (`src/renderer/shell/sidebar/EpicsSection.tsx:50`), Canvas пуст, что делать дальше — не сказано.
- Что сюда приносят соседние Ticket-ы этого Epic-а:
  - Ticket 11 — Profile schema 2 на машине (`~/.claude/worfy-harness/projects/<project>/`), поля
    `mode`, `language.docs`, `attribution`, `mcp.allowed`; `bin/profile` читает оттуда.
  - Ticket 14 — реестр Gate переезжает в `~/.claude/worfy-harness/gate/config.json`; Profile-ы worfy,
    Auction и Atakama уже перенесены.
  - Ticket 17 — коллекции qmd по Profile (Q16).
  - Ticket 19 — экран первого запуска: проверка Harness и его версии.
  - Ticket 22 — Silent mode в Harness: поле Profile `workflow.folder` — путь Workflow folder (папки,
    где лежат файлы workflow Project-а); `bin/profile` отдаёт `_resolved.mode`,
    `_resolved.workflow_folder` и `_resolved.repos`; worktree новых Project-ов — в
    `<HARNESS_HOME>/worktrees/<project>/` (Q17). Значения этих полей пишет подключение — этот Ticket.
  - Ticket 23 — папку вне git worfy добавляет в список, если Harness её знает: `profile -C <папка>` —
    код 0 и `_resolved.workspace` не `null`. Незнакомую папку вне git отклоняет и в тексте отказа
    отправляет к форме подключения.
- Факты для черновика Profile:
  - SDK 0.3.289 (`package.json:23`) умеет структурированный ответ: опция `outputFormat:
    {type: 'json_schema', schema}` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1975`), итог
    приходит в поле `structured_output` сообщения `result` (`:5798`).
  - Session вне Project идёт без инструментов Canvas (`src/main/agent/options.ts:77-78`).
  - Session принадлежит Project-у по своему cwd (`src/main/claude-home/registry.ts:10-12`).
  - Строка сценария fake-агента — SDK-сообщение как есть (`src/main/agent/fake-query.ts:4`): `result`
    со `structured_output` test может отдать без правки fake-агента.
  - Overlay Canvas — файл в `src/renderer/canvas/overlays/`, Canvas находит его сам, без правки
    `Canvas.tsx` (`src/renderer/canvas/extensions.ts:7-9`).

## Что делаем

Подключение — один диалог «Add project» по шагам. До кнопки «Connect» последнего шага ничего не
пишется ни на машину, ни в репозиторий.

1. **Папка** (Q29, ADR-0018). Пользователь выбирает папку. worfy определяет её вид, только чтением
   (`git rev-parse`, как сейчас):
   - git-репозиторий; подпапка и linked worktree сводятся к корню, как сейчас;
   - папка над несколькими репозиториями: сама не в git, а среди её прямых подпапок не меньше двух
     корней git-репозиториев (как Atakama);
   - иначе — отказ с причиной, как сейчас.

   Если `profile -C <папка>` отвечает кодом 0, Profile уже есть: Project добавляется в список сразу,
   как сейчас, без черновика (правило Ticket-а 23). Так подключаются worfy, Auction и Atakama после
   переноса (Ticket 14).
2. **Режим** (Q23, Q28, Q29). Выбор Full mode или Silent mode; по умолчанию — Silent mode. У папки над
   несколькими репозиториями — только Silent mode: Full недоступен, причина рядом. Для Silent mode —
   Workflow folder (Q24), поле `workflow.folder` (Ticket 22): по умолчанию
   `<HARNESS_HOME>/projects/<project>/workflow/`; у папки над несколькими репозиториями — сама эта
   папка (её `.scratch/` и HANDOFF остаются на месте). Пользователь может выбрать другую. В Full mode
   `workflow.folder` — `null`.
3. **Проверка Harness.** Тем же кодом, что у экрана первого запуска (Ticket 19): plugin `worfy`
   установлен и включён, его версия равна версии worfy (Q12). Не так — подключение дальше не идёт:
   диалог называет причину и открывает экран первого запуска.
4. **Черновик Profile пишет агентская Session.** worfy запускает Session с cwd = папка Project-а и
   первым сообщением `/worfy:connect-project <папка> <full|silent> --draft-only`.
   - Новый skill `harness/skills/connect-project/SKILL.md` (по-английски, Q6) говорит агенту, что
     читать: команды проверки (скрипты `package.json`, Makefile, CI), менеджер пакетов, стек; что уже
     есть из файлов workflow (`.scratch/`, HANDOFF, ADR, `CONTEXT.md`); основную ветку и `origin`. И
     что предложить: поля Profile schema 2 по контракту `harness/profiles/README.md` (Ticket 11), текст
     `rules.md` с разделом источников, записи реестра Gate — по одной на репозиторий, у папки над
     несколькими репозиториями все с одним `profile` (как у Atakama сейчас).
   - Значения, которые черновик ставит сам:
     - `mode` и `workflow.folder` — из шагов 1–2;
     - `worktree.root` — значение для новых Project-ов из контракта после Ticket-а 22
       (`<HARNESS_HOME>/worktrees/<project>/`, Q17);
     - `language.docs` — язык уже лежащих документов Project-а; без документов — `language.reports`
       (так контракт сейчас решает язык новых документов);
     - `workflow.finish` — `pr-green-ci`, если есть `origin`, иначе `local-green` (Q30; права аккаунта
       уточняет Ticket 25);
     - `mcp.allowed` — значение контракта по умолчанию; `attribution` — `on` (Q25);
     - `github.account` — `null` (аккаунт выбирается в Ticket-е 25).
   - Session ничего не пишет: `disallowedTools` — `Write`, `Edit`, `NotebookEdit`; с `--draft-only`
     skill возвращает черновик и останавливается. Ответ — `structured_output` по JSON Schema черновика
     (`outputFormat`): объект `{ profile, rules, gate }`.
   - Без `--draft-only` (терминал; вторая машина — цена решения Q11') skill показывает черновик,
     спрашивает подтверждение и сам вызывает `project-connect` (пункт 6).
   - Диалог показывает ход Session (последнее действие) и кнопку «Stop». Это обычная Session worfy:
     после подключения её транскрипт виден на Canvas Project-а, как у любой Session этой папки.
5. **Форма.** Человек правит поля черновика: имя Profile; команды `commands.*`; скрипты Gate `fast` и
   `full`; `tickets.branch`; `review.lenses`; `mcp.allowed`; `language.reports`, `language.team`,
   `language.docs`; `attribution`; `workflow.finish`; `rules.md` — текстовым полем. Режим и Workflow
   folder видны, но меняются только в шаге 2. Остальные поля — JSON только для чтения.
   `language.reports` по умолчанию — язык системы (`app.getLocale()`: `ru…` → `ru`, иначе `en`).
   Перед «Connect» worfy проверяет черновик тем же скриптом (`project-connect --check`): ошибка — под
   полем, «Connect» недоступна.
6. **Запись и регистрация в Gate — только скриптом Harness**, не кодом worfy: worfy меняет состояние
   workflow только инструментами Harness (ADR-0002), и тот же скрипт нужен подключению из терминала.
   Новый `harness/bin/project-connect` (node, как `bin/profile`):
   - читает черновик из stdin; `--check` — только проверка, ничего не пишет;
   - пишет `profile.json` и `rules.md` в `$HARNESS_HOME/projects/<имя>/` и записи реестра в
     `$HARNESS_HOME/gate/config.json` (`HARNESS_HOME` — папка состояния Harness, по умолчанию
     `~/.claude/worfy-harness/`, Ticket 08);
   - Workflow folder по умолчанию (Silent mode) создаёт и делает в ней `git init` (Q24); выбранную
     пользователем папку берёт как есть. Ticket 22 описывает поле и структуру папок Workflow folder, но папку не создаёт;
   - фиксирует запись одним коммитом в git `HARNESS_HOME` (Q4);
   - заводит коллекции qmd тем средством, что сделал Ticket 17 (Q16). qmd нет или модели пропущены —
     шаг пропускается, причина в выводе, подключение не отменяется;
   - в репозиторий Project-а ничего не пишет;
   - сбой посередине — откат того, что успело записаться;
   - коды выхода: 0 — записано; 1 — черновик не прошёл схему, имя Profile занято или такой `match`
     уже есть в реестре (причина в stderr, ничего не записано); 2 — ошибка вызова. Вывод — JSON
     (`name`, `profileDir`, `gateKeys`, `workflowFolder`, `qmd`), без русского текста (Q6).

   После кода 0 `profile -C <папка>` отвечает кодом 0, и worfy добавляет Project в список
   (`ProjectStore.add`) и делает его активным. Папка над несколькими репозиториями проходит по правилу
   Ticket-а 23: реестр теперь знает её репозитории под одним Profile, и `_resolved.workspace` не
   `null`.
7. **Project без Epic-ов.** Новый overlay Canvas: у активного Project-а Epic-ов нет, а чтение workflow
   прошло без ошибки — по центру Canvas панель «No epics yet» с одной фразой и кнопкой «Plan first
   epic». Кнопка открывает Orchestrator Project-а (`orchestrator.open`); текст в него не отправляется,
   первую цель называет человек. Появился первый Epic — панели нет.
8. **`ProjectStore` этот Ticket не меняет.** Какую папку вне git принимать в список, решает Ticket 23;
   репозиторий на Node Ticket-а, Gate, PR и CI по нему — тоже Ticket 23.

ADR не нужен: решения — ADR-0042 и ADR-0045; запись через скрипт Harness следует правилу ADR-0002.

**Не входит:** аккаунт GitHub и права на `origin` (Ticket 25); смена режима у подключённого Project-а
(в E3 её нет, Q28); перенос Profile-ов worfy, Auction и Atakama (Ticket 14); чтение Workflow folder,
файлов workflow Silent Project-а и правило добавления папки вне git в `ProjectStore` (Ticket 23).

## Готово, когда

- [ ] contract `test/contract/projects-connect.test.ts`: вид папки — git-репозиторий; подпапка и
  linked worktree (к корню); папка над двумя репозиториями (вид `multi-repo` и список репозиториев);
  папка без репозиториев — отказ с причиной.
- [ ] contract: для папки, на которую подменённый `bin/profile` отвечает кодом 0, Project добавляется
  в список, а подменённый запуск Session черновика не вызван.
- [ ] contract: Harness не установлен или его версия не равна версии worfy (подменённый ответ проверки
  Ticket-а 19) — Session черновика не запускается, ответ называет причину.
- [ ] contract: Session черновика получает cwd = папка, `outputFormat` со схемой черновика,
  `disallowedTools` с `Write`, `Edit`, `NotebookEdit` и первое сообщение
  `/worfy:connect-project <папка> silent --draft-only`. Fake-агент со сценарием `profile-draft.jsonl`
  отдаёт `structured_output` — форма получает черновик. Черновик не по схеме — ошибка, ничего не
  записано.
- [ ] contract: у папки над несколькими репозиториями `mode` в черновике и в записи — только
  `silent`, `workflow.folder` по умолчанию — сама папка; Full mode ответ отклоняет с причиной. После
  записи (подменённый `project-connect` с кодом 0 и подменённый `profile -C` с кодом 0 и
  `_resolved.workspace`) Project в списке.
- [ ] `bash harness/bin/tests/project-connect.test.sh` — код 0. Песочница: `HARNESS_HOME`, `HOME` и
  `CLAUDE_CONFIG_DIR` во временной папке. Проверяется:
  - черновик пишется в `projects/<имя>/` и в реестр; после записи
    `harness/bin/profile -C <репозиторий> --field mode` печатает выбранный режим, код 0;
  - Silent mode с Workflow folder по умолчанию создаёт `projects/<имя>/workflow/` с `.git`;
  - `--check` ничего не пишет;
  - занятое имя и уже зарегистрированный `match` — код 1, файлы и реестр не изменились;
  - в git `HARNESS_HOME` ровно один новый коммит;
  - `git status --porcelain --ignored --untracked-files=all` репозитория Project-а пуст.
- [ ] e2e `test/e2e/projects-connect.spec.ts`: «Add project» → временный репозиторий → Silent mode по
  умолчанию → черновик fake-агента → форма → «Connect». Project в списке и активен; на Canvas панель
  «No epics yet»; «Plan first epic» открывает Orchestrator; репозиторий не тронут
  (`git status --porcelain --ignored --untracked-files=all` пуст, как в `test/e2e/projects.spec.ts:146`).
- [ ] unit `test/unit/first-epic.test.tsx`: панель видна при пустом списке Epic-ов и чтении без
  ошибки; не видна при ошибке чтения и при первом Epic-е.
- [ ] `test/e2e/projects.spec.ts` проходит с новым диалогом: папка без репозиториев получает отказ
  шага 1; репозиторий, который Harness уже знает, добавляется без черновика; повторное добавление
  подключённого Project-а — как раньше.
- [ ] `GATE_SCOPE=all gate.sh full` на ветке после rebase — код 0 и вердикт Gate «зелено»; e2e и
  `.app` проверяются только здесь, под замком `/tmp/worfy-e2e.lock`.
- [ ] (вручную) Stable copy после влития и `pnpm install:stable`: открыть подключение временного
  репозитория с `package.json` (скрипты `lint`, `test`) в Silent mode; черновик пишет настоящая
  Session. В форме — команды из `package.json`, `mode: silent`, Workflow folder по умолчанию; в
  репозитории `git status --porcelain --ignored` пуст. «Connect» не нажимать: настоящий
  `~/.claude/worfy-harness/` не меняется, запись проверяют test-ы в песочнице. Как проверить: окно
  приложения и терминал.

## Тесты

Сначала падающий test — `test/contract/projects-connect.test.ts`: папка над двумя
незарегистрированными репозиториями даёт на шаге 1 вид `multi-repo` и оба репозитория. Без этого
Ticket-а её можно только отклонить: `projects.add` отвечает «is not a git repository»
(`src/main/projects/store.ts:204`; после Ticket-а 23 — отказом со ссылкой на форму подключения) —
test падает. В «Итог» — как он падал.

- `test/contract/projects-connect.test.ts` — новый: вид папки, Profile уже есть, проверка Harness,
  параметры Session черновика, разбор `structured_output`, вызов `project-connect`.
- `harness/bin/tests/project-connect.test.sh` — новый: запись, `--check`, отказы, откат, коммит,
  Workflow folder по умолчанию, чистый репозиторий.
- `test/e2e/projects-connect.spec.ts` — новый: подключение целиком на собранном приложении.
- `test/unit/first-epic.test.tsx` — новый: панель «No epics yet».
- `test/fixtures/agent-scripts/profile-draft.jsonl` — новый сценарий fake-агента: `system/init`, ход,
  `result` со `structured_output` черновика.

Test-ы, которые меняются вместе с поведением:

- `test/e2e/projects.spec.ts:76-79` — «Add project» открывает диалог: папка вне git без репозиториев
  получает отказ шага 1, репозитории добавляются через диалог (в test-е — с подменённым
  `bin/profile`, который их уже знает, или через черновик fake-агента).

Все test-ы — с временными `WORFY_DATA_DIR`, `WORFY_CLAUDE_HOME` и `HARNESS_HOME`; настоящий
`~/.claude` и `~/.claude/worfy-harness/` они не трогают.

## Где в коде

- `src/main/projects/connect.ts` — новый: шаги подключения (вид папки, Profile уже есть, проверка
  Harness, Session черновика, вызов `project-connect`)
- `src/main/ipc/projects.ts`
- `src/shared/ipc/projects.ts`
- `src/main/agent/options.ts` — структурированный ответ и запрет правки файлов для Session черновика
- `src/renderer/projects/ConnectProject.tsx` — новый: диалог по шагам и форма
- `src/renderer/shell/sidebar/ProjectsSection.tsx`
- `src/renderer/canvas/overlays/FirstEpic.tsx` — новый
- `harness/skills/connect-project/SKILL.md` — новый
- `harness/bin/project-connect` — новый
- `harness/bin/tests/project-connect.test.sh` — новый
- `harness/profiles/draft.schema.json` — новый: JSON Schema черновика (profile, rules, gate); часть
  profile ссылается на схему Profile schema 2 Ticket-а 11, если тот её завёл
- `harness/profiles/README.md` — из ~/.claude/profiles/README.md; раздел «Новый проект»: скрипт
  подключения вместо четырёх ручных шагов
- `test/contract/projects-connect.test.ts` — новый
- `test/e2e/projects-connect.spec.ts` — новый
- `test/e2e/projects.spec.ts`
- `test/unit/first-epic.test.tsx` — новый
- `test/fixtures/agent-scripts/profile-draft.jsonl` — новый

Ticket 23 может идти в той же Wave: оба ждут Ticket 22. Граница: Ticket 23 владеет
`src/main/projects/store.ts` (какую папку принять в список) и `test/contract/projects.test.ts`; этот
Ticket их не трогает и строит диалог поверх правила Ticket-а 23. Если Ticket 23 правит текст отказа
и задевает `test/e2e/projects.spec.ts`, у Ticket-ов общий файл, и они идут по очереди. Если `launchApp`
в `test/e2e/helpers.ts` нужен новый параметр, исполнитель добавляет этот файл в список и сверяет его с
Ticket-ами Wave. Ticket 25 продолжает те же файлы подключения после влития этого.

## Итог

Ветка `worfy-harness/24`, worktree `.claude/worktrees/h24`. PR #176. Три круга: первый круг, доработка
по ревью (`pre-rework-sha` 7312508), круг владельца 2026-10-09 (`pre-owner-round-sha` 0f5df32,
решение — PR #176 issuecomment-6079208406).

**Первый test.** `test/contract/projects-connect.test.ts`, случай «папка над двумя репозиториями — вид
`multi-repo` и оба репозитория». На базе 08e8256 упал при загрузке: `Cannot find module
'../../src/main/projects/connect'` — способа узнать вид такой папки не было; единственный путь,
`ProjectStore.add`, отвечал «is not a git repository».

**Что сделано.**
- Пункт 1. `src/main/projects/connect.ts`, `inspectFolder`: git-репозиторий (подпапка и linked worktree —
  к корню, с пояснением), папка над двумя и более репозиториями (`multi-repo`, список по имени), иначе
  отказ с причиной (без репозиториев; с одним — «выберите сам репозиторий»). Только `git rev-parse`.
  `profileKnows`: `profile -C <папка> --json` код 0 (для `multi-repo` — ещё `_resolved.workspace`) —
  папка сразу идёт в список через `ProjectStore.add`, без черновика. `ProjectStore` не менялся.
- Пункт 2. Диалог `src/renderer/projects/ConnectProject.tsx`: Silent по умолчанию; у `multi-repo`
  Full недоступен с причиной рядом; Workflow folder — по умолчанию
  `<HARNESS_HOME>/projects/<name>/workflow/` (у `multi-repo` — сама папка), «Choose…» /
  «Use default». main отказывает Full для `multi-repo` и в черновике, и при записи.
- Пункт 3. `harnessBlocker` по тому же состоянию установщика, что у экрана первого запуска
  (`appInstaller().status()`): не установлен / другая версия / выключен / ошибка — Session не
  запускается, диалог называет причину и даёт кнопку «First-run checks…», которая закрывает диалог и
  открывает экран первого запуска.
- Пункт 4. **Session черновика без Bash** (решение владельца, вариант (б)). Сначала
  `bin/project-connect --facts <папка>` вне агента читает то, что раньше давала бы команда: вид папки и
  по каждому репозиторию текущую и основную ветку, есть ли коммиты, remotes (без логина и пароля в URL)
  и `origin`. worfy кладёт этот JSON данными в первое сообщение после
  `/worfy:connect-project <папка> <mode> --draft-only`. Session: cwd = папка, `outputFormat` со схемой
  `harness/profiles/draft.schema.json`, `allowedTools` — `Read`, `Glob`, `Grep`; `disallowedTools` —
  `Bash`, `BashOutput`, `KillShell`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `WebFetch`,
  `WebSearch`, `Task`, `Agent`; `canUseTool` пропускает только `Read`, `Glob`, `Grep` и
  `StructuredOutput`, остальное — отказ. Session читает только настройки пользователя
  (`settingSources: ['user']`) и просит у уровня политики `allowManagedPermissionRulesOnly`
  (`src/main/agent/options.ts`, `draftSessionOptions`). Stop работает и пока читаются факты.
  Ответ сначала проверяется `project-connect --schema-only` (не по схеме — ошибка со списком полей,
  ничего не записано), потом worfy ставит своё (`applyChoices`: `mode`, `workflow.folder`,
  `worktree.root`, `language.reports` из `app.getLocale()`, `github.account: null`, имя Profile в
  записях Gate) и спрашивает `--check`. Skill `harness/skills/connect-project/SKILL.md` (англ.): только
  Read/Glob/Grep, ветки и remotes — из фактов; в терминале без блока фактов — попросить пользователя
  выполнить `project-connect --facts` и вставить вывод.
- Пункт 5. Форма: имя, `commands.*`, Gate `fast`/`full` по каждой записи, `tickets.branch`,
  `workflow.finish`, `review.lenses`, `mcp.allowed`, три языка, `attribution`, `rules.md`; режим и Workflow
  folder только показаны; остальное — JSON только для чтения. Каждая правка через 350 мс идёт в
  `project-connect --check`; ошибка — под своим полем (граница цвета blocked; фокус — `outline` цвета
  accent), ошибки без поля — списком сверху; «Connect» недоступна при ошибках и пока проверка не
  прошла (сбой проверки держит её недоступной); правка снимает старую ошибку записи.
- Пункт 6. `harness/bin/project-connect` (node): `--facts`, `--check`, `--schema-only`, запись
  `profile.json` и `rules.md`, записи в `gate/config.json`, Workflow folder по умолчанию с `git init`
  (выбранная — как есть, но не внутри репозиториев), один коммит в git `HARNESS_HOME` (`git init` и
  `.gitignore` Harness home, если его нет), откат при сбое, коды 0/1/2, вывод JSON. qmd-коллекции —
  только после коммита: `bin/qmd-collections` при `qmd` и `qmd-models` = `downloaded` (иначе пропуск с
  причиной), поле `qmd` в `profile.json` входит в тот же коммит (`--amend`). Сбой qmd подключение не
  отменяет: если `index.yml` уже записан (упал `qmd update`), поле `qmd` остаётся и коммитится, в выводе —
  только «qmd update failed»; если `index.yml` не тронут — `profile.json` возвращается к коммиту. После
  кода 0 worfy проверяет `profile -C`, добавляет папку в список (настоящий `ProjectStore`; папку вне git
  он берёт после Ticket-а 23) и делает её активной. Раздел «New project» `harness/profiles/README.md` —
  скрипт вместо четырёх ручных шагов.
- **Worktree** (решение владельца). `worktree.root` — `<репозиторий>/.claude/worktrees/` (у `multi-repo`
  — `null`). У Silent Project-а `project-connect` дописывает `.claude/worktrees/` в `.git/info/exclude`
  каждого репозитория (общий git dir, так что и для linked worktree), один раз, без дублей; в
  `.gitignore` и отслеживаемые файлы — ничего. Откат при сбое возвращает файл как был. Worktree вне
  репозитория в этот Ticket не входят.
- Пункт 7. Overlay `src/renderer/canvas/overlays/FirstEpic.tsx`: «No epics yet», одна фраза, «Plan
  first epic» → `orchestrator.open` и Session view Orchestrator-а, текст не отправляется.
- Каналы IPC: `projects.connect.inspect|draft|stop|check|write` и событие `projects.connect.activity` —
  все `local` (Linked machine не подключает Project-ы); `projects.pickFolder` получил необязательный
  `purpose` (папка Project-а или Workflow folder).
- Вне следа: `test/contract/harness-migrate.test.ts:240` сравнивал `harness/skills/` ровно со списком
  skill-ов старого Harness; новый `connect-project` есть только у plugin-а — добавлен в ожидание.
  `test/e2e/own-sessions.spec.ts`, `test/e2e/toolbar.spec.ts`, `test/e2e/two-windows.spec.ts` добавляют
  репозиторий через «Add project» — каждый кладёт подменённый `bin/profile` (`--json` — код 0,
  `--field` — код 4) в `<Claude home>/bin`, как `projects.spec.ts`. `test/unit/connect-project.test.tsx`
  и `src/renderer/projects/connect-project.css` — новые.

**Test-ы.**
- `test/contract/projects-connect.test.ts` — 18 случаев: виды папки; известная папка (Session не
  вызвана); три отказа Harness; параметры Session черновика (только Read/Glob/Grep, Bash в
  `disallowedTools`) и первое сообщение с фактами (fake-агент `profile-draft.jsonl`); `canUseTool`
  отказывает Bash и всему, кроме Read/Glob/Grep/StructuredOutput; сбой фактов — Session не запускается;
  Stop во время фактов; черновик не по схеме; Stop Session; опции `draftSessionOptions`; форма и запись
  настоящими `bin/project-connect` и `bin/profile` в песочнице; `multi-repo` до конца через настоящий
  `ProjectStore`: до записи — отказ, после — в списке и активен, `.git/info/exclude` обоих репозиториев.
- `harness/bin/tests/project-connect.test.sh` — 98 проверок: `--facts` (remotes без пароля,
  `origin/HEAD`, подпапка, репозиторий без remotes, `multi-repo`, отказ, ничего не пишет), запись,
  `--check`, отказы, откат на каждом шаге (и `.git/info/exclude`), `.git/info/exclude` (один раз, уже
  была строка, linked worktree, Full — не трогает, `git status` не видит дерево Ticket-а), один коммит,
  qmd после коммита, сбой `qmd update` после записи `index.yml`.
- `test/unit/first-epic.test.tsx` — 5 случаев; `test/unit/connect-project.test.tsx` — 4.
- `test/e2e/projects-connect.spec.ts` — 2 сценария; `test/e2e/projects.spec.ts` — отказ шага 1 из
  диалога, репозитории через подменённый `bin/profile`, повторное добавление — «is already in the list».
- Mutant-ы (в своём worktree, восстановлены из копии), все красные: без шага exclude, без проверки
  дубля, `--git-dir` вместо общего, без очистки пароля в URL, без ветки «index.yml записан», без отката
  exclude, Bash в `DRAFT_TOOLS`, без Bash в `disallowedTools`, `canUseTool` пускает всё, без проверки Stop
  после фактов, без снятия ошибки записи; прошлых кругов — без отката, без проверки Harness, без Workflow
  folder `multi-repo`, qmd до коммита, без `--amend`, `settingSources` по умолчанию, shorthand `border`,
  без цвета ошибки, «Connect» без `checkError`.

**Снимки** (Playwright, своя сборка; форма с ошибкой — поле без фокуса):
[Silent](../evidence/24-connect-silent-light.png) / [тёмная](../evidence/24-connect-silent-dark.png),
[Full](../evidence/24-connect-full-light.png) / [тёмная](../evidence/24-connect-full-dark.png),
[форма с ошибкой](../evidence/24-connect-form-error-light.png) /
[тёмная](../evidence/24-connect-form-error-dark.png), [форма](../evidence/24-connect-form-light.png) /
[тёмная](../evidence/24-connect-form-dark.png), [Harness не установлен](../evidence/24-connect-harness-light.png) /
[тёмная](../evidence/24-connect-harness-dark.png), [No epics yet](../evidence/24-first-epic-light.png) /
[тёмная](../evidence/24-first-epic-dark.png).

**Решено без владельца, подтвердить.**
- Шаг 3 при отказе не открывает экран первого запуска сам, а даёт кнопку «First-run checks…» (экран
  перекрыл бы причину).
- Default Workflow folder исключён из истории Harness home строкой `/projects/*/workflow/` в
  `.gitignore` (у него свой git). У существующего `.gitignore` строку дописывает `project-connect` в
  том же коммите.
- Одна запись Gate на репозиторий получает имя Profile-а: при переименовании в форме ключ единственной
  записи меняется вместе с именем.

**Не проверено.**
- не проверено: ручной пункт со Stable copy (настоящая Session пишет черновик) — GUI-проверки не мои по
  брифу; настоящий Claude Code не запускался.
- не проверено: что `outputFormat` вместе со streaming input отдаёт `structured_output` у настоящего
  SDK 0.3.289, и что инструмент ответа называется `StructuredOutput` и проходит `canUseTool` — по
  `sdk.d.ts` и fake-агенту. Если имя другое, `canUseTool` откажет ему, и черновик не придёт (ошибка в
  диалоге, ничего не записано).
- не проверено: что настоящий Claude Code оставляет ключ `allowManagedPermissionRulesOnly` из
  `managedSettings` SDK. Без него allow-правила пользователя могут пропустить `Read`/`Glob`/`Grep` мимо
  `canUseTool` — других инструментов у Session нет (`disallowedTools`), так что это ничего не открывает.

### Gate оркестратора (2026-10-09)

- Круг 1 — `REJECTED` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/176#issuecomment-6074571476)): нет отката шага qmd; список «читающих» команд Bash пропускал пишущие; три [low] формы.
- Круг 2 — `REJECTED` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/176#issuecomment-6075059618)): новые high — `git ls-remote --upload-pack` и `sort -o` проходили список; снимки ошибки поля в фокусе; [med] откат `profile.json` при сбое `qmd update`. Ticket — `blocked`, к владельцу.
- Решение владельца 2026-10-09 ([комментарий](https://github.com/IDSAD-XL/worfy/pull/176#issuecomment-6079208406)): вариант (б) — черновик без Bash, факты считает `project-connect`; worktree под `<repo>/.claude/worktrees/`, у Silent — в `.git/info/exclude`.
- Круг владельца — `VERIFIED` ([комментарий](https://github.com/IDSAD-XL/worfy/pull/176#issuecomment-6079843699)), diff `0f5df32..407f1d7`. Долги:
  - [low] `harness/bin/project-connect:129` — `withoutCredentials` вырезает только `user:pass@`; токен в query-строке URL remote (`?access_token=…`) доходит до черновика.
  - [low] `src/main/projects/connect.ts:245` — Read, Glob, Grep черновика не ограничены папкой (например, `~/.ssh`); так было и до круга, писать и выходить в сеть нечем.
  - [low] `harness/skills/connect-project/SKILL.md:39` — в терминале skill просит пользователя запустить `--facts`, а шаги `:92`, `:95` запускают `project-connect` сами.
- Мерж: rebase на `8092d7b`, `GATE_SCOPE=all gate full` — код 0 с первого прогона, CI зелёный, CLEAN, влит `119425a`.

### Подтверждение владельца (2026-10-10)

Все решения этого Ticket-а с пометкой «решено без владельца, подтвердить» подтверждены владельцем 2026-10-10.
