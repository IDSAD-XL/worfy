# 17 — Очередь gate на Mac: команда /worfy:gate-queue, действие «Process gate queue», уведомление

Type: task
Status: claimed 2026-10-18T04:25Z
Branch: worfy-windows/17
Blocked by: 07
Source: решения владельца 2026-10-08: Q32 (команда Harness `/worfy:gate-queue` проходит все PR с меткой `needs-mac-gate`; Autopilot на Mac запускает её перед каждой Wave и когда больше нечего делать; в worfy — действие «Process gate queue»; уведомление, если PR ждёт больше часа), Q30 (метка `needs-mac-gate`), Q31 (Windows проверяет main после мержа), Q33 (раздел «Mac checks» в описании PR и отчёт Session на Mac в PR); spec.md, «Решения владельца», «Как работает очередь needs-mac-gate», и «Соглашения», «Метка needs-mac-gate» ([spec.md](../spec.md)); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md) «Windows checks and two sessions», пункты 4–6; ADR Ticket-а 07 (уточняет ADR-0056; файл создаёт Ticket 07); [ADR-0002](../../../docs/adr/0002-worfy-is-a-view-over-the-workflow.md) (worfy не пишет Status Ticket-ов); [ADR-0006](../../../docs/adr/0006-ipc-contract-by-declaration-merging.md) (домены IPC); [ADR-0024](../../../docs/adr/0024-autopilot-wave-end-and-keep-awake.md) (конец Wave Autopilot); [ADR-0044](../../../docs/adr/0044-harness-in-english-language-from-profile.md) (Harness по-английски)

## Что происходит

- Ticket 07 вписывает правило метки `needs-mac-gate` в skills. На Machine с ролью `serve` (Mac;
  поле Profile `cross_machine_gate.role`) раздел 1 `epic-wave` перед своей Wave проходит открытые PR
  с меткой: rebase, `check` (gate full на Mac), команды раздела «Mac checks» из описания PR, отчёт в
  PR, мерж или красный отчёт. Проход есть только внутри Wave.
- У Session на Mac Wave может не быть: Epic `worfy-link` закрыт или стоит, а Autopilot
  останавливается с `no-ready-wave` или `blocked-tickets`, когда готовой Wave нет
  (`src/shared/autopilot/cycle.ts:206`). Тогда PR с меткой ждут, и никто этого не видит (spec.md,
  риск 6). Владелец решил (Q32): проход очереди — отдельная команда Harness; Autopilot на Mac
  запускает её перед каждой Wave и когда больше нечего делать; в worfy — действие «Process gate
  queue» и уведомление о PR, который ждёт больше часа.
- Действий worfy два — «Ship ticket» и «Run wave» (`src/shared/projects/action-templates.ts:19`).
  Каждое шлёт текст шаблона Project-а; «Run wave» — Orchestrator-у Project-а и отказывает, пока в
  Project-е идёт Autopilot (`src/main/actions/launch.ts:172-176`). В palette они — группа Action
  (`src/renderer/palette/commands.ts:85`, `:132`). Меню Project-а в боковой панели — Settings и
  Remove (`src/renderer/shell/sidebar/ProjectsSection.tsx:58`). Поле шаблона в настройках Project-а
  появляется для каждого действия из `ACTIONS` само (`src/renderer/shell/ProjectSettings.tsx:149`).
- Уведомления worfy — только о Session-ах: конец хода и запрос разрешения (`src/main/notify.ts:1-18`).
  Записка `Note` всегда несёт Session (`:35`), клик открывает её. При фокусе окна worfy уведомление
  не показывается (`:144`).
- PR worfy читает одним `gh pr list` с GH_TOKEN аккаунта Project-а (`src/main/github/prs.ts:31`,
  `accountAuth` — `:95`). Метки, время создания и коммиты PR в этом чтении не запрашиваются.
- Profile worfy читает через `bin/profile` (`profileRunner`, `src/main/workflow/profile.ts:58`).
  Поле `cross_machine_gate` (Ticket 07) worfy не читает.
- `gh … --jq` без внешнего `jq` на Windows-ПК работает: `gh pr list --json number,headRefName,files
  --jq '…'` в Git Bash — EXIT=0, а `jq` в Git Bash нет (evidence Ticket-а 01, разделы 05 и 19).
- `pnpm test` на Windows-ПК до Epic-а не зелёный: 55 файлов упали (evidence, раздел 17); их чинят
  Ticket-ы 02–14.

## Что делаем

1. **Правило «PR ждёт Machine с `serve`»** — одно для команды Harness и для worfy:
   - PR открыт, на нём метка `cross_machine_gate.label`;
   - в PR нет отчёта новее последнего коммита PR. Отчёт — комментарий, первая строка которого
     начинается с `<checks_section> report:` (формат задаёт Ticket 07; у worfy —
     `Mac checks report: green` или `Mac checks report: red`);
   - время ожидания — от более позднего из двух моментов: создание PR (`createdAt`) и последний
     коммит (`commits`, `committedDate`).

   PR с отчётом о красном новее последнего коммита ждёт не очередь, а Machine с `request`: она чинит
   и пушит. Повторный gate full по нему ничего не даёт.
2. **Команда Harness `/worfy:gate-queue`** — новый skill `harness/skills/gate-queue/SKILL.md`, текст
   по-английски (ADR-0044); имя метки и раздела skill берёт из Profile, а не пишет в текст.
   - Profile без `cross_machine_gate` (exit 4) — одна Machine, очереди нет: skill говорит это и
     заканчивает. `role: request` — очередь проходит другая Machine: то же.
   - `role: serve` — `gh pr list --state open --label <label> --json
     number,headRefName,createdAt,commits,comments` со встроенным в `gh` фильтром `--jq`, без
     внешнего `jq`. Ждущие PR по правилу 1 — старые первыми, по одному. Для каждого — проход,
     который Ticket 07 вписал в раздел 1 `epic-wave`, переносится сюда без изменений: worktree на
     ветке PR, rebase, `git push --force-with-lease`, `check`, команды раздела `checks_section`,
     ожидание CI, отчёт (`gh pr comment`), затем мерж и снятие метки или красный отчёт. Мерж — под
     замком главной ветки из раздела 4 `epic-wave`.
   - PR, которые по правилу 1 не ждут, — строкой с причиной («waits for the requesting machine»);
     их skill не трогает.
   - В конце — таблица: PR, вердикт, мерж или ссылка на отчёт. Ждущих PR нет — `queue empty`.
   - Ticket-ы чужого Epic-а skill не берёт и их Status не меняет.
3. **`epic-wave`, раздел 1.** При `serve` первым шагом — `/worfy:gate-queue` вместо прежнего блока
   прохода; итог — в отчёт Wave (раздел 5). Так Autopilot на Mac проходит очередь перед каждой
   Wave: он шлёт «Run wave», и skill `epic-wave` начинает с очереди. Текст прохода — один, в
   `gate-queue`. При `request` раздел не меняется. Новых разделов нет: test держит их номера
   (`epic-wave` 0–5). Случай блока раздела `checks_section` в
   `harness/bin/tests/skill-blocks.test.sh` (его добавил Ticket 07) вырезает блок уже из
   `gate-queue/SKILL.md`: в `epic-wave` этого блока больше нет.
4. **`harness/README.md`** — `gate-queue` в таблице skills.
5. **Чтение очереди в worfy** — `src/main/github/gate-queue.ts` (новый):
   - Profile этой Machine: `cross_machine_gate.role`, `.label`, `.checks_section` — через
     `profileRunner`; `src/main/workflow/profile.ts` не меняется. Exit 4, нет Harness, сбой
     скрипта — очереди нет, `gh` не зовётся, причина — в лог.
   - PR: `gh pr list --state open --label <label> --limit 100 --json
     number,title,url,createdAt,commits,comments` через `ghRunner` и `accountAuth` из
     `src/main/github/prs.ts`; сам файл не меняется. GH_TOKEN — аккаунта Project-а, глобальный
     аккаунт `gh` не переключается. Только чтение: других команд `gh` нет.
   - Правило 1 — чистая функция: PR, метка раздела, «сейчас» → ждущие PR с `since`, старые первыми.
   - Одно чтение на Project раз в 5 минут, пока Project открыт в worfy. Сбой `gh` — интервал
     удваивается до 30 минут, первый успех возвращает 5 минут.
6. **IPC `gateQueue.get`** — `src/shared/ipc/gate-queue.ts` и `src/main/ipc/gate-queue.ts` (новые;
   домен находится сам, ADR-0006). Запрос `{ projectId }`, ответ — роль этой Machine (`serve`,
   `request` или `null`), метка, ждущие PR (номер, заголовок, ссылка, `since`) и состояние `gh`
   (ok или причина). Renderer спрашивает его при открытии palette и меню Project-а
   (`src/renderer/projects/useGateQueue.ts`, новый).
7. **Действие «Process gate queue».**
   - `src/shared/projects/action-templates.ts`: `gateQueue` в `ACTIONS`, подпись
     `Process gate queue`. Шаблон при Harness `plugin` и `none` — `/worfy:gate-queue`; при `legacy`
     — пустой: в старом Harness такого skill нет, и действие говорит «Set the Process gate queue
     template in Project settings». Плейсхолдеров нет. Сохранённые настройки без `gateQueue`
     читаются с шаблоном по умолчанию.
   - `src/main/actions/launch.ts`: `ActionLauncher.gateQueue(projectId)` шлёт текст шаблона
     Orchestrator-у Project-а, как «Run wave». Отказ с причиной: роль этой Machine не `serve` (роль
     читается заново); шаблон пуст; в Project-е идёт Autopilot — «Autopilot is running in this
     Project: it processes the gate queue itself».
   - IPC `actions.gateQueue` — `src/shared/ipc/actions.ts`, `src/main/ipc/actions.ts`.
   - palette (`src/renderer/palette/commands.ts`, `actionCommands`): команда `Process gate queue` в
     группе Action, только при `serve`. Detail — `2 PRs waiting, oldest 3 h` или `queue empty`;
     ключи поиска — `gate queue` и имя метки. Состояние очереди в контекст palette передаёт
     `src/renderer/palette/CommandPalette.tsx`.
   - меню Project-а (`src/renderer/shell/sidebar/ProjectsSection.tsx`): пункт «Process gate queue»
     между Settings и Remove, только при `serve`.

   worfy только шлёт сообщение Orchestrator-у, как «Run wave»: Status Ticket-ов, метки и PR он сам
   не трогает (ADR-0002).
8. **Уведомление** (`src/main/notify.ts`). Наблюдатель очереди из пункта 5 запускается в
   `src/main/index.ts` рядом с `installNotifications`, над Project-ами, открытыми в worfy.
   - PR ждёт по правилу 1 больше часа — одно уведомление на PR и его последний коммит. Новый коммит
     — снова через час ожидания.
   - Заголовок — имя Project-а. Текст — `PR #<N> <title> has waited for the gate queue for over an
     hour`. На `serve` — ещё `Run Process gate queue`. На `request` — `No machine has taken it
     yet`: worfy на Mac выключен или не проходит очередь, и владелец узнаёт это на Windows-ПК.
   - Правила Notifier те же: при фокусе окна worfy уведомление не показывается и ждёт следующего
     чтения. Клик поднимает окно worfy и Session не открывает: у `Note` появляется вид записки без
     Session.
9. **Autopilot, «когда больше нечего делать»** (`src/main/autopilot/run.ts`). Цикл решил
   остановиться с `no-ready-wave` или `blocked-tickets`, роль этой Machine — `serve`, шаблон
   `gateQueue` задан. Тогда перед `run-stopped` прогон шлёт текст шаблона Orchestrator-у и пишет в
   журнал событие `gate-queue` с этим текстом (`src/shared/autopilot/journal.ts`). Ход кончается
   по правилам Wave: конец хода, фоновые задачи, ожидание Limits. Потом — `run-stopped` с той же
   причиной. Один раз за прогон. При `request`, при Stop и Force stop владельцем, при
   `limits-timeout` и ошибках шага нет. Stop владельцем во время этого хода — мягкий, как в Wave.

ADR не нужен: решения Q30–Q33 записывает ADR Ticket-а 07, здесь — их исполнение.

**Не входит:** правило метки, раздел «Mac checks» и gate full на свежем main на Windows — Ticket 07;
проход очереди по таймеру без Autopilot и без владельца — Q32 его не называет; уведомления на
Linked machine-ах — Epic `worfy-link`, Ticket 13; живой проход очереди командой
`/worfy:gate-queue` — Ticket 16, пункт 2: PR этого Ticket-а Session на Mac проходит вручную, а
команда, запущенная из его ветки, прошла бы и сам этот PR.

## Готово, когда

- [ ] `harness/bin/tests/gate-queue.test.sh` (новый; идёт в `pnpm test` через `test/contract/harness-scripts.test.ts`): в `gate-queue/SKILL.md` — `cross_machine_gate`, `--label`, `--force-with-lease`, `checks_section`, `report: green`, `report: red`, `gh pr comment` раньше `gh pr merge`, `--remove-label`, правила «one at a time» и «no merge without the report», ветки exit 4 и `request`, `queue empty`. Слов `needs-mac-gate` и `Mac checks` в тексте нет; кириллицы нет.
- [ ] `gate-queue.test.sh`, блок выбора PR из `gate-queue/SKILL.md`, `gh` подменён stub-ом. Три PR с меткой: без отчёта; с отчётом `Mac checks report: red` новее последнего коммита; с таким же отчётом старше последнего коммита. Блок печатает первый и третий, старый первым; второй — строкой «waits for the requesting machine». Под bash и под zsh на Mac.
- [ ] `epic-wave-ship-ticket.test.sh`: в разделе 1 `epic-wave` при `serve` — `/worfy:gate-queue`; блока прохода в разделе 1 больше нет — ни `--force-with-lease`, ни `--remove-label`, ни `report: green` (раздел 4 с перебазированием `BEHIND` эта проверка не смотрит). Проверки номеров разделов и кириллицы проходят.
- [ ] `skill-blocks.test.sh`: случай блока раздела `checks_section` (Ticket 07) вырезает блок из `gate-queue/SKILL.md` и проходит с прежними ожиданиями — две команды, `none`, `no-section`; в `epic-wave/SKILL.md` этого блока нет.
- [ ] `harness/README.md`: `gate-queue` в таблице skills.
- [ ] Contract `test/contract/gate-queue.test.ts` (новый); `gh` и `bin/profile` подменены функциями. Profile без поля (exit 4) — роль `null`, `gh` не вызван. `serve` — один `gh pr list` с `--label needs-mac-gate` и GH_TOKEN аккаунта Project-а. Правило 1 на тех же трёх PR, что в test-е skill-а. Сбой `gh` — причина в ответе, следующее чтение через 10 минут.
- [ ] Unit `test/unit/notify.test.ts`, подменённые часы: PR ждёт 59 минут — уведомления нет; 61 минуту — одно; следующее чтение с тем же коммитом — нет; новый коммит и ещё час — снова одно. Окно в фокусе — нет; после потери фокуса — на следующем чтении. Текст на `serve` и на `request` — как в пункте 8. Клик поднимает окно и Session не открывает.
- [ ] Unit `test/unit/action-templates.test.ts`: `gateQueue` в `ACTIONS`; шаблон при `plugin` и `none` — `/worfy:gate-queue`, при `legacy` — пустой; сохранённые настройки без `gateQueue` читаются с шаблоном по умолчанию.
- [ ] Unit `test/unit/launch.test.ts` и contract `test/contract/actions.test.ts`: `actions.gateQueue` при `serve` шлёт `/worfy:gate-queue` Orchestrator-у Project-а. При `request`, без поля, с пустым шаблоном и при идущем Autopilot — отказ с причиной из пункта 7, сообщение не отправлено.
- [ ] Unit `test/unit/palette-commands.test.tsx` и `test/unit/shell.test.tsx`: при `serve` — команда palette `Process gate queue` с detail `2 PRs waiting, oldest 3 h` (без ждущих — `queue empty`) и пункт меню Project-а; при `request` и без поля — ни команды, ни пункта.
- [ ] Unit `test/unit/autopilot-run.test.ts` и `test/unit/autopilot-journal.test.ts`: прогон на `serve` без готовой Wave — в журнале `gate-queue` с текстом шаблона, затем `run-stopped` с `no-ready-wave`; то же с `blocked-tickets`. На `request`, после Stop владельцем и при `limits-timeout` события `gate-queue` нет. Схема журнала принимает `gate-queue`.
- [ ] Windows-ПК: `pnpm lint`, `pnpm typecheck` — exit 0; `pnpm test` — exit 0, а пока не влит Ticket 14 — падения сверены со списком evidence Ticket-а 01 (раздел 17) и Итог-а Ticket-а 02: новых нет. Mac: gate full зелёный (по правилу needs-mac-gate: проверяет и вливает Session на Mac).
- [ ] (вручную) Mac, упакованная сборка этой ветки (`pnpm package`), открытая через `open`, Project worfy: очередь читается настоящим `gh`. В palette — команда `Process gate queue`, в detail посчитан PR этого Ticket-а (метка есть, отчёта ещё нет); в меню Project-а — пункт «Process gate queue». Команду не запускать: она прошла бы и этот PR. Detail и снимки palette и меню в двух темах — в отчёт Session на Mac в PR (через раздел Mac checks PR, Q33).
- [ ] (вручную) Mac, та же сборка: уведомление о PR, который ждёт больше часа, — снимок и номер PR в отчёт в PR. Такого PR за время проверки не было (после rebase ожидание этого PR считается заново) — пункт закрывает `test/unit/notify.test.ts`, в отчёт — «живого случая не было» (через раздел Mac checks PR, Q33).

## Тесты

Сначала падающий test — `harness/bin/tests/gate-queue.test.sh`: файла `gate-queue/SKILL.md` нет, и
test красный. Затем `test/contract/gate-queue.test.ts`: модуля `src/main/github/gate-queue.ts`
нет — test падает на импорте. В Итог — вывод обоих красных прогонов.

Блоки вырезаются из `SKILL.md` тем же способом, что в `harness/bin/tests/skill-blocks.test.sh:18-21`
(функция `block` по уникальной строке блока). Проверка текста — `has`/`lacks` из
`harness/bin/tests/epic-wave-ship-ticket.test.sh:17-19`. `gh` в contract test-е подменяется
функцией `GhRunner`, а не фикстурой `test/fixtures/gh/`.

## Где в коде

- `harness/skills/gate-queue/SKILL.md` — новый
- `harness/skills/epic-wave/SKILL.md`
- `harness/bin/tests/gate-queue.test.sh` — новый
- `harness/bin/tests/epic-wave-ship-ticket.test.sh`
- `harness/bin/tests/skill-blocks.test.sh`
- `harness/README.md`
- `src/main/github/gate-queue.ts` — новый
- `src/shared/ipc/gate-queue.ts` — новый
- `src/main/ipc/gate-queue.ts` — новый
- `src/renderer/projects/useGateQueue.ts` — новый
- `src/shared/projects/action-templates.ts`
- `src/main/actions/launch.ts`
- `src/shared/ipc/actions.ts`
- `src/main/ipc/actions.ts`
- `src/renderer/palette/commands.ts`
- `src/renderer/palette/CommandPalette.tsx`
- `src/renderer/shell/sidebar/ProjectsSection.tsx`
- `src/main/notify.ts`
- `src/main/index.ts`
- `src/main/autopilot/run.ts`
- `src/shared/autopilot/journal.ts`
- `test/contract/gate-queue.test.ts` — новый
- `test/unit/notify.test.ts`
- `test/unit/action-templates.test.ts`
- `test/unit/launch.test.ts`
- `test/contract/actions.test.ts`
- `test/unit/palette-commands.test.tsx`
- `test/unit/shell.test.tsx`
- `test/unit/autopilot-run.test.ts`
- `test/unit/autopilot-journal.test.ts`

Только читаются и не меняются: src/main/github/prs.ts (функции ghRunner и accountAuth),
src/main/workflow/profile.ts (profileRunner), src/shared/autopilot/cycle.ts. С Ticket-ом 14 (та же
Wave 7) общих файлов нет: src/main/github/prs.ts и test/fixtures/gh/ этот Ticket не меняет.

## Итог

Сделано в ветке `worfy-windows/17`. PR — платформенный (ADR-0056: трогает скрипты Harness), метка
`needs-mac-gate`; gate full и мерж — Session на Mac.

**Красные прогоны до кода** (раздел «Тесты»):

- `bash harness/bin/tests/gate-queue.test.sh` без `harness/skills/gate-queue/SKILL.md`: `passed 0,
  failed 1`, exit code 1 (файла skill-а нет).
- `pnpm -s test test/contract/gate-queue.test.ts` без модуля:

  ```
  FAIL  |contract| test/contract/gate-queue.test.ts [ test/contract/gate-queue.test.ts ]
  Error: Cannot find module '../../src/main/github/gate-queue' imported from .../test/contract/gate-queue.test.ts
   Test Files  1 failed (1)
  ```

**Что вышло.**

- `/worfy:gate-queue` — `harness/skills/gate-queue/SKILL.md`. Проход очереди перенесён из раздела 1
  `epic-wave` (перебазирование, проверка, отчёт, мерж), а не скопирован; `epic-wave` раздел 1 при
  `serve` теперь зовёт skill. Мерж в skill-е идёт под lock-ом main-ветки (`<git-common-dir>/main.lock`).
- worfy: чтение очереди (`src/main/github/gate-queue.ts`, раз в 5 минут, при сбое `gh` интервал
  удваивается до 30 минут), IPC `gateQueue.get`, действие `actions.gateQueue` («Process gate queue»)
  в palette и в меню Project-а только при `serve`, уведомление о PR, который ждёт больше часа,
  шаг Autopilot перед `run-stopped` с `no-ready-wave` и `blocked-tickets` (событие журнала
  `gate-queue`).

**Где код разошёлся с текстом Ticket-а** (сделано по коду):

- Блок выбора PR берёт ещё `headRefName`, `headRefOid` и `isCrossRepository`: проход Ticket-а 07
  нуждается в ветке и голове PR и пропускает PR из fork-ов.
- Отчётом считается только комментарий аккаунта `github.account`, как в блоке `request` Ticket-а 07.
  Без аккаунта отчёт не засчитывается, и ждут все PR с меткой.
- Test пункта меню Project-а — в `test/unit/use-projects.test.tsx`, а не в `test/unit/shell.test.tsx`:
  меню Project-а и его тесты живут там (`shell.test.tsx` подменяет секции sidebar-а).
- Файлы вне раздела «Где в коде», без которых не проходит `pnpm test`: `scripts/critical-path.mjs`
  (список событий журнала), `src/main/ipc/autopilot.ts` (проводка шага Autopilot),
  `test/contract/harness-migrate.test.ts`, `test/unit/terminal-shell.test.ts`,
  `test/contract/projects.test.ts`, `test/unit/project-settings-shell.test.tsx` (третий шаблон
  действия), `test/unit/link-access.test.ts` (метки read и write новых каналов),
  `test/contract/autopilot-journal.test.ts`, `test/contract/app-user-model-id.test.ts` (mock модуля
  notify).

**Проверки на Mac** (exit code):

- `bash harness/bin/tests/gate-queue.test.sh` — 0 (48 проверок, stub `gh` вызван 12 раз);
  `skill-blocks.test.sh` — 0 (141); `epic-wave-ship-ticket.test.sh` — 0 (335).
- `pnpm lint && pnpm typecheck` — 0; `pnpm test` — 0 (6061 passed, 70 skipped).
- Mutation testing новых строк: 36 mutant-ов, 35 убиты (один — зависанием test-а на 240 s: lock
  main-ветки не снят). Выжил один: проверка Stop до чтения шаблона повторяла проверку после
  чтения. Лишняя проверка убрана, test-ы после этого — exit 0.

**Не сделано здесь:** пункты «(вручную)» — упакованная сборка, palette, меню и уведомление на Mac;
Windows-ПК: `pnpm lint`, `pnpm typecheck`, `pnpm test` и три shell-теста — их список в описании PR.
