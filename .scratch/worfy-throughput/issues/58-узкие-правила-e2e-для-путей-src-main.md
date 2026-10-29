# 58 — Узкие правила e2e для путей `src/main` в `scripts/e2e-specs.table.json`: сначала замер, какие пути чаще всего шлют PR на весь набор

Type: task
Status: open
Blocked by: —
Source: решение владельца 2026-10-29, раунд 3, Q9 ([spec.md](../spec.md), раздел «Ответы владельца 2026-10-29,
раунд 3»); замер после 12 PR с кодом в «Итог» Ticket-а [54](54-меньше-pr-на-полном-наборе-e2e-macos.md).

## Что происходит

- Планка владельца Q4: медиана времени по стене PR — от push до `ci-ok`, очередь включена — не больше 15 min.
  Замер в «Итог» Ticket-а 54 (10 run-ов PR по новому правилу `ci-scope`) — медиана 15,8 min: планка не выполнена.
- Длина job-ов — не главное. Медиана без ожидания в очереди macOS — 4,8 min; остальное — очередь macOS runner-ов.
  Бесплатный план даёт 5 macOS-job-ов одновременно на весь account; их делят все открытые PR и `main`.
- Весь набор e2e (два shard-а `macos-e2e (1/2)`, `(2/2)`, по 14–21 min каждый) — 4 из 12 PR замера: #994, #995,
  #996, #1000. У всех четырёх правка `src/main/…`, которой нет в таблице путей. Такие run-ы без ожидания идут
  13–19 min, а два macOS-job-а вместо одного удлиняют очередь для остальных PR.
- Почему путь `src/main` шлёт на весь набор: `e2eSpecs` в `scripts/ci-scope.mjs` (около строк 210–232) для пути
  под `src/` или `harness/`, который не совпал ни с одним правилом `scripts/e2e-specs.table.json`, отвечает
  `<path> is not in scripts/e2e-specs.table.json` и `files: null` — весь набор. Сегодня в таблице 31 путь
  `src/main/…`: `src/main/browser/*`, `src/main/link/*`, несколько файлов `src/main/ipc/` и `src/main/images/`.
- Ограничение владельца (Q9): «не выходим за бесплатный лимит раннеров». Больше одновременных job-ов, другие или
  платные runner-ы — не способ закрыть этот Ticket.

## Что делаем

1. **Замер.** Последние ~30 PR с кодом, влитых в `main` (`gh pr list -R IDSAD-XL/worfy --state merged --limit 60
   --json number,files,mergedAt`, без PR только с документами). Для каждого — пути из `files`, прогнанные через ту
   же логику, что `e2eSpecs` в `scripts/ci-scope.mjs` на таблице сегодняшнего `main`. Итог замера — таблица: путь
   `src/main/…` (или папка) → сколько PR он отправил на весь набор. Считать только PR, у которых именно этот путь —
   первая причина весь набор (строка `why`), и отдельно — PR, у которых он единственная такая причина.
2. **Правила таблицы.** Для путей с наибольшим числом PR — новые строки `scripts/e2e-specs.table.json`, которые
   ведут путь на его spec-файлы. Правило таблицы прежнее (её поле `about`): строка добавляется, только когда код под
   её glob-ами e2e test-ы видят только через её spec-файлы; при сомнении путь в таблицу не идёт. Какие spec-файлы
   видят модуль — по импортам, по IPC-каналам и по тому, что e2e test открывает в приложении; рассуждение по
   каждой строке — в поле `why` строки и в «Итог».
3. **Contract test на каждую строку** — в стиле `test/contract/ci-scope-e2e.test.ts`: изменённый путь строки даёт
   свои spec-файлы и число shard-ов меньше полного; путь соседнего модуля вне строки по-прежнему даёт весь набор.
4. **Повторный замер** — на 10 PR с кодом, влитых после merge этого Ticket-а, тем же методом, что в «Итог»
   Ticket-а 54 (`created_at`, `started_at`, `completed_at` job-ов run-а финального head PR, без логов).

## Готово, когда

- [ ] «Итог»: таблица замера по ~30 PR (путь → число PR на весь набор), команды и коды выхода.
- [ ] Новые строки в `scripts/e2e-specs.table.json`, у каждой — поле `why`; test-ы
      `test/contract/ci-scope-e2e.test.ts` про таблицу этого репозитория зелёные: каждый glob совпадает с файлом,
      каждый spec-файл существует.
- [ ] Contract test на каждую новую строку (пункт 3 «Что делаем»). Mutant: строка удалена — test этой строки
      красный.
- [ ] `ci.yml`, число и вид runner-ов не меняются: в diff нет `.github/workflows/**`.
- [ ] Медиана времени по стене следующих 10 PR с кодом — не больше 15 min (очередь включена); таблица в «Итог».
      Если больше — в «Итог» причина по тем же данным (очередь или длина job-ов) и следующий шаг.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Тесты

- `test/contract/ci-scope-e2e.test.ts` — новые случаи по одному на строку таблицы; существующие случаи не меняются.
- Unit test-ы `scripts/ci-scope.mjs`, если затронута его логика (по плану не затронута: меняется только таблица).

## Где в коде

- `scripts/e2e-specs.table.json` — таблица путей и spec-файлов.
- `scripts/ci-scope.mjs` — `e2eSpecs` (около строк 210–232), `NARROWED` (строка 166), `e2eShards`.
- `test/contract/ci-scope-e2e.test.ts`.
- `test/e2e/*.spec.ts` — только чтение: какие spec-файлы видят модуль.

## Вне скоупа

- Больше одновременных job-ов, macOS-job-ы на других runner-ах, платные runner-ы — запрет владельца (Q9).
- Правка `.github/workflows/ci.yml`, shard-ов `macos-e2e` и `macos-tests`.
- Пути вне `src/main` (`src/renderer`, `src/shared`, `harness/`) — если замер покажет, что они дают заметную долю
  PR на весь набор, это строка в «Итог» и предложение следующего Ticket-а.

## Итог

Итог implementer-а 2026-10-30, после круга ревью 1: замер сделан. В `scripts/e2e-specs.table.json` добавлена
одна строка: `src/main/first-run/checks.ts` и `src/main/first-run/actions.ts` → 5 spec-файлов, 1 shard из 2. По
времени из `test/e2e/timings.json` это 84 s из 1686 s. Для неё есть contract test и mutant. Остальные пути
`src/main` из замера выполняются при запуске приложения или в действиях, у которых нет доказуемого набора
spec-файлов. По правилу таблицы (поле `about`: «when in doubt, leave the path out») они в таблицу не идут.

### Замер: 30 последних PR с кодом

Метод. `gh pr list -R IDSAD-XL/worfy --state merged --limit 80 --json number,title,files,mergedAt` (exit 0).
PR с кодом — тот, у которого есть файл вне `*.md`, `.scratch/`, `docs/`. Взяты 30 последних по `mergedAt`:
#953 … #1023. Пути каждого PR прогнаны через `e2eSpecs` из `scripts/ci-scope.mjs` на таблице `main`
d829ab9c (`readSpecTable`, `listSpecs` из `scripts/e2e-shard.mjs`). Причина весь набор для пути — `e2eSpecs`
этого одного пути даёт `files: null`. Первая причина — путь, который назвал `why` всего PR. Скрипт замера
лежит вне репозитория (scratchpad implementer-а). Сверка с CI: у финального head каждого из 30 PR взяты
check-run-ы `macos-e2e*` (`gh api repos/IDSAD-XL/worfy/commits/<sha>/check-runs`, exit 0, без логов).

Итог по 30 PR: весь набор на таблице сегодняшнего `main` — 16 PR. По CI тогда — 17: #977 и #965 шли на весь
набор, потому что строк Browser и Harness в таблице ещё не было. #979 правил `.github/workflows/ci.yml`, но
шёл без e2e: `pullRequest` в `ci-scope.mjs` отбрасывает `ci.yml`, если правка не трогает сборку и e2e.

| Чем PR попал на весь набор | PR | Сколько |
|---|---|---|
| причины только в `src/main` | #1020, #1000, #996, #995, #969 | 5 |
| `src/main` и ещё `src/renderer`, `src/shared` или фикстуры | #1018, #1011, #1012, #994, #975 | 5 |
| `.github/workflows/ci.yml` (с поправкой на `pullRequest`: 3, без #979) | #1023, #979, #970, #953 | 4 |
| `playwright.config.ts`, `test/e2e/helpers.ts` | #1026 | 1 |
| `src/renderer` и помощник `test/e2e` | #1007 | 1 |

Пути `src/main` — первая причина весь набор хотя бы у одного PR. В столбце «Единственная причина» — PR, у
которых этот путь — единственный путь, отправивший PR на весь набор.

| Путь | Первая причина | Единственная причина | Среди причин |
|---|---|---|---|
| `src/main/first-run/checks.ts` | 2 (#1011, #995) | 0 | 2 |
| `src/main/storage/move.ts` | 1 (#1000) | 0 | 2 (#1000, #969) |
| `src/main/actions/launch.ts` | 1 (#994) | 0 | 1 |
| `src/main/cards/protocol.ts` | 1 (#1018) | 0 | 1 |
| `src/main/claude-home/hidden-subagents.ts` | 1 (#975) | 0 | 1 |
| `src/main/claude-home/registry.ts` | 1 (#996) | 1 (#996) | 1 |
| `src/main/layout/archive.ts` | 1 (#1012) | 0 | 1 |
| `src/main/layout/trash.ts` | 1 (#969) | 0 | 1 |
| `src/main/terminal/cursor-answers.ts` | 1 (#1020) | 1 (#1020) | 1 |

Ещё 16 путей `src/main` встречаются среди причин по одному разу и ни разу не первые. Это `autopilot/run.ts`,
`ipc/autopilot.ts`, `agent/orchestrator.ts` (#994); `index.ts`, `link/caller.ts`, `cards/remote.ts`,
`images/protocol.ts`, `images/stores.ts` (#1018); `harness/install.ts`, `harness/migrate/plan.ts`,
`ipc/harness-migration.ts`, `projects/connect.ts` (#1011); `ipc/first-run.ts` (#995); `storage/remove.ts`
(#1000); `claude-home/subagents.ts`, `ipc/claude-home.ts` (#975).

Шире, 80 PR с кодом (#896 … #1023): весь набор — 32 PR. Чаще всего среди причин — `.github/workflows/ci.yml`
(10 PR). Среди путей `src/main` чаще других — `autopilot/run.ts` и `ipc/autopilot.ts` (3 PR: #994, #933, #928). У всех трёх есть и другая причина: `actions/launch.ts`,
`settings/store.ts`, `agent/limits-usage.ts`. Только в `src/main` — 9 PR. Из них, кроме пяти выше: #931 и
#920 (`agent/options.ts`), #918 (`agent/session.ts`), #907 (`terminal/zsh/rc.d/20-suggest-ai.zsh`).

### Какие пути стали строкой таблицы и почему остальные — нет

Строка годится, только когда код под её glob-ами e2e test-ы видят лишь через её spec-файлы. Проверены
импорты, IPC-каналы и то, что приложение делает при запуске.

- **Строка: `first-run/checks.ts`, `first-run/actions.ts`** (#995 и #1011 — первая причина). Их импортирует
  только `src/main/ipc/first-run.ts:22-23`, а `actions.ts:35` ещё импортирует `checks.ts`. Код выполняется
  четырьмя путями:
  1. `firstRun.startup`, если `WORFY_FIRST_RUN_AUTO` не равен 0. `test/e2e/launch-env.ts:93` ставит 0 каждому
     запуску, через `launchEnv` и `directStartEnv`. Значение 1 ставят только `first-run.spec.ts:91` и
     `harness-migrate.spec.ts:156`. Обработчик выходит до проверок: `src/main/ipc/first-run.ts:189`.
  2. `firstRun.checks` и `firstRun.run` с экрана первого запуска. Экран открывают команда палитры «First-run
     checks» (`src/renderer/palette/commands.ts:305`; это делают `first-run.spec.ts` и
     `settings-health.spec.ts`) и кнопка «First-run checks…» в Connect Project (`ProjectsSection.tsx:525`;
     это делает `projects-connect.spec.ts:178`).
  3. Те же каналы из Settings → Health (`HealthSection.tsx:26`, `checkOnShow`) — `settings-health.spec.ts`.
     Settings открывается на General и показывает по одному разделу (`SettingsDialog.tsx:49-53`). Health
     выбирают только в `settings-health.spec.ts`.
  4. `askAccount` через `askSignedInAccount` (`ipc/first-run.ts:99`). Его зовёт только `PlanSource.get` при
     `planPreset.read` и `apply` (`ipc/plan-preset.ts:55`, `:130`, `:140`). Это Settings → Plan, то есть
     `settings.spec.ts:331`.

  Других вызовов каналов `firstRun.*` и `planPreset.*` в `src/renderer` и `test/e2e` нет: grep
  `firstRun\.|planPreset\.` находит только `first-run-store.ts`, `FirstRunChecks.tsx`, `PlanSection.tsx`,
  `first-run.spec.ts`, `settings-health.spec.ts`. Contract test проверяет набор двумя способами. Первый —
  test строки. Второй — семья `the first-run checks` в `FAMILIES`: она ищет пути к экрану в тексте spec-файлов
  и их помощников, находит ровно эти 5 и требует, чтобы строка давала их все. `src/main/ipc/first-run.ts`
  остаётся вне таблицы: его `firstRun.startup` выполняет каждый запуск, пусть и с немедленным выходом.
  Поэтому #995 (вторая причина — `ipc/first-run.ts`) идёт на весь набор и с этой строкой.
- `storage/move.ts` (#1000, #969). `moveWhenFree` зовут только `put` и `restore` корзины
  (`src/main/layout/trash.ts:217`, через `this.move` на `:258`, `:276`, `:330`), а не очистка при запуске
  (`ipc/trash.ts:42-52`). Перенос идёт, только если у удаляемого Node-а есть Card (`kind: 'card'`, `cardIdOf`)
  или картинка. Такой Node создают layout-ы spec-файлов, UI, MCP tools fake-агента (сценарии в
  `test/fixtures/agent-scripts`) и связь между машинами. Удаляют его Delete, Backspace, selection toolbar,
  меню и ⌘Z. Grep «удаляет и есть Card или картинка» находит 5 spec-файлов (`canvas-image`, `linked-images`,
  `no-overlap`, `tidy-up`, `trash-undo`), оценка ревью — около 11. Признака без пропусков нет: Card из сценария
  агента в тексте spec-файла не видна. Кроме того, отдельная строка для `move.ts` не сузила бы ни один PR
  замера: в #1000 вторая причина — `storage/remove.ts`, в #969 — `layout/trash.ts`. Есть сомнение — путь в
  таблицу не идёт. `storage/remove.ts` импортирует `storage/json-file.ts:21`, то есть его код идёт в каждой
  записи настроек и layout-а. `layout/trash.ts` выполняет очистку при каждом запуске.
- `claude-home/registry.ts` (#996). Его используют `agent/app-node-sessions.ts`, `agent/app-orchestrators.ts`,
  `ipc/bindings.ts`, `gate/state.ts`, `layout/archive.ts`, `claude-home/search.ts`, `claude-home/subagents.ts`.
  Код видит каждый spec.
- `terminal/cursor-answers.ts` (#1020). `CursorAnswers` создаёт `terminal/pty.ts` для каждого pty: для
  Terminal Node-ов (`ipc/terminal.ts`, `terminal.open`), для входа в gh (`ipc/projects.ts`,
  `github/accounts.ts`) и для терминала первого запуска (`FirstRunChecks.tsx`). Node вида `terminal` задают
  layout-ы 7 spec-файлов, и ещё больше spec-файлов создают его через UI и Terminal AI. Слово terminal есть
  в 43 файлах `test/e2e` (`grep -rli terminal test/e2e`). Надёжного признака «spec открывает pty» без пропусков нет, а пропуск значит регрессию
  до push в `main`. Есть сомнение — путь в таблицу не идёт.
- `autopilot/run.ts`, `ipc/autopilot.ts` (самые частые на 80 PR). При первом за день открытии Canvas-а с
  эпиками renderer зовёт `autopilot.state` (`src/renderer/canvas/arrangement-record.ts`, `activityNow`). Это
  строит `Autopilot` из `run.ts` (`sharedAutopilot`) и запускает `refreshHarness` (`autopilot/harness-drift.ts`).
  Так бывает почти в каждом spec-файле с Project-ом. `ipc/autopilot.ts` ещё вызывает Browser MCP server
  (`mcp/browser-server.ts`, `runningEpic`).
- `layout/archive.ts` (#1012) — его импортируют `src/main/index.ts` и `ipc/layout.ts`.
  `cards/protocol.ts`, `images/protocol.ts`, `images/stores.ts` (#1018) отдают Card-ы и картинки каждому окну.
  Это уже сказано в поле `why` строки картинок. `actions/launch.ts`, `agent/orchestrator.ts` (#994) запускают
  каждую Session. Код видит каждый spec.
- `claude-home/hidden-subagents.ts`, `subagents.ts`, `ipc/claude-home.ts` (#975). `ipc/claude-home.ts`
  отдаёт список Session-ов каждого Canvas-а. Кроме того, #975 правил ещё 9 путей `src/renderer` и
  `src/shared`, так что строка для main этот PR не сузила бы.

С новой строкой ни один из 30 PR замера не сужается целиком: у #995 и #1011 остаются другие причины. Замер на
таблице этой ветки — по-прежнему 16 PR на весь набор. Единственные причины по одному пути — #1020
(`terminal/cursor-answers.ts`) и #996 (`claude-home/registry.ts`). Это пути, которые выполняет каждый
spec-файл или почти каждый.

### Что дальше (предложение, не сделано здесь)

- Узнать, какие spec-файлы выполняют модуль, по факту, а не по рассуждению. Пусть полный run e2e на push в
  `main` один раз пишет V8 coverage main process по каждому spec-файлу. Из этого строится карта «модуль
  `src/main` → spec-файлы, которые его выполнили». Модуль, который выполняют все spec-файлы, остаётся на весь
  набор. Для остальных строки таблицы получаются из данных. Это отдельный Ticket: нужна правка e2e helpers и
  workflow-а, а `ci.yml` здесь трогать нельзя.
- `src/renderer` и `src/shared` — среди причин в 5 PR из 16 (#1018, #1011, #1012, #1007, #975). Такой же
  разбор renderer-а — следующий Ticket по пункту «Вне скоупа».
- `.github/workflows/ci.yml` — 3 PR из 16 по CI (#1023, #970, #953). Правки CI сами по себе шлют на весь
  набор. Это решение владельца, здесь не менялось.

### Команды и коды выхода

- `gh pr list -R IDSAD-XL/worfy --state merged --limit 80 --json number,title,files,mergedAt` — exit 0
  (и `--limit 160` для окна в 80 PR — exit 0).
- скрипт замера (`e2eSpecs` и `readSpecTable` из `scripts/ci-scope.mjs`, `listSpecs` из `scripts/e2e-shard.mjs`,
  30 и 80 PR) — exit 0.
- `gh pr view <n> --json headRefOid` и `gh api repos/IDSAD-XL/worfy/commits/<sha>/check-runs` по 30 PR — exit 0.
- `pnpm lint` — exit 0; `pnpm typecheck` — exit 0.
- `pnpm test test/contract/ci-scope-e2e.test.ts test/contract/ci-workflow.test.ts test/unit/affected-tests.test.ts`
  (все test-ы, которые читают `ci-scope`) — exit 0: 3 файла, 278 passed, 8 skipped (карантин worfy-polish 41).
- те же test-ы на mutant-ах строки (строка удалена; из строки убран `settings.spec.ts`) — exit 1 оба раза:
  красные test строки и семья `the first-run checks`.
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0: 476 файлов passed, 7 skipped; 10376 test-ов passed.
- gate fast — exit 0, `[gate] green (fast): worfy/.:lint worfy/.:typecheck worfy/.:test`.

### «Готово, когда»

- [x] Таблица замера по 30 PR, команды и коды выхода — выше.
- [x] Новая строка `src/main/first-run/{checks,actions}.ts` с полем `why`. Test-ы таблицы зелёные: каждый glob
      совпадает с файлом, каждый spec-файл существует. Остальные пути — раздел выше.
- [x] Contract test строки (`test/contract/ci-scope-e2e.test.ts`: test строки и семья `the first-run checks`).
      Mutant 1: строку удалили — оба test-а красные, exit 1. Mutant 2: из строки убрали `settings.spec.ts` —
      оба test-а красные, exit 1. Таблицу восстановили из копии.
- [x] В diff нет `.github/workflows/**`.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.
- [ ] Медиана времени по стене следующих 10 PR — после merge, не implementer.
- [ ] Повторный замер на 10 PR — после merge, не implementer.
