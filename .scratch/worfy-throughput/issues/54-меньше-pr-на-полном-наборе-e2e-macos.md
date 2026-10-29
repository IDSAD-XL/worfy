# 54 — Меньше PR на полном наборе e2e macOS: узкие триггеры полного набора и `macos-package`

Type: task
Status: done 2026-10-29T12:04Z
PR: #979
Blocked by: 11 (Ticket [11](11-pr-вливается-по-задетым-test-ам-полный-набор-на-main.md) правит те же файлы —
`.github/workflows/ci.yml` и `scripts/ci-scope.mjs`)
Source: замер 2026-10-29 около 09:30 UTC по 13 последним завершённым run-ам `ci.yml` и по macOS-job-ам этих run-ов
(данные Orchestrator-а); планка владельца Q4 ([spec.md](../spec.md), раздел «Ответы владельца 2026-10-29»): время
по стене от push до `ci-ok`, очередь включена.

## Что происходит

Замер 2026-10-29 около 09:30 UTC: 13 последних завершённых run-ов `ci.yml`, по `created_at`, `started_at` и
`completed_at` каждого job-а. Ожидание в очереди macOS — `started_at − created_at`, максимум по macOS-job-ам run-а.

- **Run-ы PR, n=11.** Медиана времени по стене — 31 min. Медиана ожидания в очереди macOS — 20 min; медиана
  времени по стене без этого ожидания — 11 min. Job-ы не на macOS ждут 0–1 min.
- **Push в `main`, n=2.** Run 40833295816 — 69 min, из них 53 min в очереди macOS; run 40830673743 — 80 min, из
  них 64 min. Без очереди — 15 min.
- **Причина** — лимит бесплатного плана: 5 macOS-job-ов одновременно на весь account. Его делят все открытые PR и
  `main` (`.github/workflows/ci.yml:38-42`).
- **Правило 8 владельца (2026-10-28):** если медиана ожидания macOS больше 10 min, shard-ы unit-test-ов macOS
  сливаются в один job (`docs/adr/0083-ci-ok-on-every-pr-is-the-merge-condition.md:108-110`). Это уже сделано:
  `macos-tests` — один job (`ci.yml:15`, `:182-185`). Ожидание всё равно 20 min.
- **macOS-job-ы по run-ам** (минуты run-а одного job-а): почти каждый PR с кодом шёл в обоих shard-ах
  `macos-e2e`, по 14–21 min каждый: #965 (Ticket 37, только текст skill-ов Harness) — 21+18 и 14+14; #953
  (Ticket 13) — 18+15; `44-trash` (#969, `src/main`) — 15+10; Ticket 11 (#970) — 16+14. `macos-package` шёл на PR
  Ticket-ов 11 и 13 и на черновике #963.

### Какие run-ы старше таблицы путей

Таблица путей e2e (`scripts/e2e-specs.table.json`, #953) влита в `main` commit-ом `87b87f6a`. Проверка
`git merge-base --is-ancestor 87b87f6a <head run-а>`:

- **Старше таблицы** (head не содержит `87b87f6a`): #965 — 40831859948 (`44afdb60`) и 40833338478 (`d57afa65`);
  #969 — 40836627395 (`fb74a3f8`); #963 — 40829545443 (`dbc87c30`) и 40836748129 (`52eb5076`); Ticket 11 —
  40838554642 (`01137d33`) и 40838997020 (`e0b46ef6`); push-и 40830673743 (`f52dc8bb`) и 40833295816
  (`8664b8da`). Run-ы самого #953 (40830265103, 40833369860) тоже без `87b87f6a`, но их checkout уже несёт таблицу:
  это PR, который её добавил.
- **Новее таблицы:** из PR с кодом — только 40842227052 (Ticket 11, `73130e28`), отменён до первого macOS-job-а.
  Остальные — PR только с документами и push-и в `main`. Run-а PR с кодом и macOS-job-ами на сегодняшнем поведении
  ещё нет.

### Что `ci-scope.mjs` даёт сегодня

Правило Harness таблицы (`scripts/e2e-specs.table.json:5-13`) — glob-ы исходников `harness/**` (`harness/skills/**`
на `:11`), не `out/harness`. Проверка путей приложения (`isAppPath`, `scripts/ci-scope.mjs:129-130`) только отбирает
пути для `e2eSpecs`; путь под `src/` или `harness/` идёт в таблицу (`:200-203`). PR только с текстом Harness уже
получает 10 spec-файлов и один shard. Synthetic diff на `origin/main` `62f31cd9` — изменён только
`harness/skills/epic-wave/SKILL.md`, `EVENT=pull_request BASE=HEAD^1 node scripts/ci-scope.mjs`, exit 0:

```
code changed: harness/skills/epic-wave/SKILL.md; no build input, so no macos-package; macos-tests runs the 18 macOS-only test files
e2e: the e2e jobs run 10 spec files by scripts/e2e-specs.table.json: test/e2e/finder-path.spec.ts test/e2e/first-run.spec.ts test/e2e/harness-install.spec.ts test/e2e/harness-migrate.spec.ts test/e2e/launch.spec.ts test/e2e/packaged.spec.ts test/e2e/projects-connect.spec.ts test/e2e/select.spec.ts test/e2e/settings-health.spec.ts test/e2e/toolbar.spec.ts
expect={"lint-typecheck":true,"linux-tests":true,"macos-tests":true,"macos-e2e":true,"macos-package":false,"windows":true,"windows-e2e":true}
macos-e2e-shards=["1/1"]
windows-e2e-shards=["1/1"]
```

Тот же synthetic run на файлах каждого PR замера (те же пути, `origin/main` `62f31cd9`):

| PR | Что решает `ci-scope` сегодня | Shard-ы `macos-e2e` | `macos-package` |
| --- | --- | --- | --- |
| #965 (текст Harness) | 10 spec-файлов по таблице | `1/1` | нет |
| #957 (Ticket 51) | `test/fixtures/eval-stub/claude.cjs reaches every e2e test` | `1/2`, `2/2` | нет |
| #969 (`src/main/layout/trash.ts`) | `src/main/layout/trash.ts is not in scripts/e2e-specs.table.json` | `1/2`, `2/2` | нет |
| #953 (Ticket 13) | `.github/workflows/ci.yml reaches every e2e test` | `1/2`, `2/2` | да |
| #970 (Ticket 11) | `.github/workflows/ci.yml reaches every e2e test` | `1/2`, `2/2` | да |
| #963 (черновик) | `.github/workflows/ci.yml reaches every e2e test` | `1/2`, `2/2` | да |

- Текст Harness больше не триггер полного набора: его закрыла таблица (#953).
- **`.github/workflows/**`** — build input целой папкой (`BUILD_FOLDERS`, `scripts/ci-scope.mjs:87`). Любая правка
  workflow — и `windows-tests.yml`, и комментарий в `ci.yml` — даёт `macos-package` и весь набор e2e. Это причина
  `macos-package` у Ticket-ов 11, 13 и #963. У #963 ещё `test/e2e/helpers.ts` (`BUILD_FILES`, `:85`) — настоящий
  вход @packaged test-ов: helpers ищут собранное приложение. Contract test-ы сейчас требуют этого поведения:
  `test/contract/ci-workflow.test.ts:596-597` (оба workflow — build input) и `:663` (workflow — все job-ы).
- **`test/fixtures/**`** — путь приложения целой папкой (`APP_FOLDERS`); путь вне `src/` и `harness/` даёт весь
  набор (`:200`). `test/fixtures/eval-stub/` e2e не читает (grep `eval-stub` в `test/e2e` пуст): его читают
  contract test-ы eval-ов.
- Путь `src/` вне таблицы (#969) — весь набор по правилу таблицы; так и остаётся.

## Что делаем

1. **Шаг 1 — замер на run-ах после `87b87f6a`.** PR с кодом, у которых шли macOS-job-ы: какой путь отправил PR на
   весь набор (строка `e2e:` в логе job-а `changes`) и почему шёл `macos-package` (нет строки «no build input»).
   Дальше — только триггеры, которые данные ещё показывают. Кандидаты сегодня — два из таблицы выше.
2. **(a) Меньше PR на всём наборе.** Для триггера `test/fixtures/**`: папки fixture-ов, которые читают e2e (grep по
   `test/e2e/` и его helper-ам, и строки `fixtures/<имя>`, и `join(…, 'fixtures', …)`), остаются путями приложения;
   остальные (как `eval-stub`) — не пути приложения. Для триггера workflow — см. (b). Остальные пути приложения
   сохраняют весь набор. Правило shard-ов (`e2eShards`, `scripts/ci-scope.mjs:220-230`) не меняется.
3. **(b) `macos-package` только на настоящий build input.** `.github/workflows/**` больше не build input целой
   папкой. `windows-tests.yml` и workflow, которые не собирают `.app`, — не build input. `ci.yml` просит
   `macos-package` и весь набор e2e, только когда diff меняет job-ы, которые их запускают (`changes`,
   `macos-e2e`, `macos-package`, `windows-e2e`); как узнать job по строкам diff-а — решает implementer, проще —
   лучше. Если шаг 1 не покажет workflow-триггер на run-ах после `87b87f6a` — (b) сводится к contract test-у
   нынешнего поведения и записи в «Итог».

Нужен ПК: нет. Трогает Harness: нет.

## Готово, когда

- [x] «Итог»: замер шага 1 — run-ы после `87b87f6a`, путь-триггер каждого PR на всём наборе и на `macos-package`.
- [x] Сначала красные contract test-ы (a) и (b): PR только с `test/fixtures/eval-stub/claude.cjs` не идёт на весь
      набор; PR только с `.github/workflows/windows-tests.yml` не просит `macos-package`. Старые ожидания
      `test/contract/ci-workflow.test.ts:596-597` и `:663` переписаны под новое правило.
- [x] Test: PR только с `harness/skills/epic-wave/SKILL.md` просит только spec-файлы правила Harness таблицы, и по
      нынешнему правилу shard-ов это `macos-e2e-shards=["1/1"]`. Сегодня он зелёный сразу — это guard, а не
      красный test.
- [x] Test: каждая папка fixture-ов, которую читает e2e, остаётся путём приложения.
- [x] `pnpm lint`, `pnpm typecheck` и `pnpm test` — exit 0; условие merge — `ci-ok`.
- [x] Замер после 10 PR с кодом (тем же методом: медиана времени по стене, медиана ожидания macOS, время без
      ожидания, сколько PR шли на всём наборе и с `macos-package`) — в «Итог».
- [x] Вердикт Windows: runner (`scripts/windows-verdict-scope.mjs`). `windows-tests.yml` этот Ticket не меняет; если
      изменит — сказать об этом в PR и в «Итог».

## Где в коде

- `scripts/ci-scope.mjs` — `BUILD_FILES` и `BUILD_FOLDERS` (`:71-87`), `APP_FILES` и `APP_FOLDERS` (`:101-117`),
  `isAppPath` (`:129-130`), `e2eSpecs` (`:192-212`), `pullRequest` (`:315-320`).
- `scripts/e2e-specs.table.json` — правило Harness (`:5-13`); правило для fixture-ов, если оно нужно.
- `.github/workflows/ci.yml` — только комментарии `:10-12`, `:18-25`, `:38-42`, если правило меняется.
- `test/contract/ci-workflow.test.ts` — test-ы scope PR (`:567-573`, `:596-597`, `:663`);
  `test/contract/ci-scope-e2e.test.ts` — test-ы таблицы и `e2eShards`.

## Почему так

- **Один shard на PR — нет.** `e2eShards` (`scripts/ci-scope.mjs:220-230`) уже даёт `1/1`, когда spec-файлы PR
  занимают меньше половины времени всех. Один shard на PR, который гоняет весь набор, — около 1686 s по
  `test/e2e/timings.json`, 28–30 min чистого run-а: одно это ломает планку 15 min. Поэтому 54 уменьшает число PR
  на всём наборе, а не число shard-ов.
- **После 11:** оба правят `ci.yml` и `scripts/ci-scope.mjs`.

## Вне скоупа

- Один shard `macos-e2e` на каждый PR — см. «Почему так».
- c. `macos-tests` на PR — только когда меняются пути, специфичные для macOS. Это вопрос владельцу; здесь не
  делается.
- Ускорение job-ов Windows и Linux: они не ждут в очереди.

## Итог

### Шаг 1: замер на run-ах после `87b87f6a` (2026-10-29, около 10:55 UTC)

Run-ы `ci.yml` по событию `pull_request` с кодом, созданные после `87b87f6a` (push в `main` 08:16 UTC). Head каждого
содержит `87b87f6a` (`git merge-base --is-ancestor`). Путь — строка `e2e:` лога job-а `changes`; `macos-package` —
есть ли в первой строке «no build input».

| PR | Run-ы (head) | Весь набор e2e — путь | `macos-package` — почему | По новому правилу |
| --- | --- | --- | --- | --- |
| #970 (Ticket 11, влит) | 40842230929 (`73130e28`), 40848990263 (`6f071e6a`), 40858408423 (`4e212b0b`); 40842227052 отменён до macOS | `.github/workflows/ci.yml reaches every e2e test`, shard-ы `1/2`, `2/2` | да: `.github/workflows/ci.yml` и `windows-tests.yml` — build input целой папкой | то же: diff меняет job `changes` (вывод `tests-base`), это часть, которая решает, что запускают e2e; `windows-tests.yml` сам по себе больше не триггер |
| #977 (карантин linked-notify, влит) | 40852416392 (`34dfcade`), 40855794394 (`52da66d1`) | `test/quarantine/linked-notify-turn-click-opens-in-b.json reaches every e2e test`, `1/2`, `2/2` | нет | то же: `test/quarantine/` — путь приложения, этот Ticket его не трогает |
| #975 (worfy-polish 45, открыт) | 40844710604 (`cbc7e4f3`), 40851345258 (`80e53112`) | `src/main/claude-home/hidden-subagents.ts is not in scripts/e2e-specs.table.json`, `1/2`, `2/2` | нет | то же: путь `src/` вне таблицы — весь набор по правилу таблицы |
| #974 (worfy-throughput 33, открыт) | 40844213262 (`4259e533`), 40849045234 (`7bab921b`) | не весь набор: 10 spec-файлов правила Harness, `1/1` | нет | то же |

- 4 PR с кодом, 9 завершённых run-ов с macOS-job-ами. На всём наборе — 3 PR (7 run-ов), с `macos-package` — 1 PR
  (#970, 3 run-а).
- Триггер workflow на данных есть (#970) — (b) сделан, не сведён к test-у нынешнего поведения. Сам #970 и по
  новому правилу шёл бы на весь набор с `macos-package`: он менял job `changes`.
- Триггер `test/fixtures/**` на run-ах после `87b87f6a` не встретился: ни один PR fixture-ы не менял. Правило
  живое (synthetic run ниже, и #957 до таблицы), поэтому (a) сделан.
- Новый триггер, которого нет в таблице выше: `test/quarantine/*.json` (#977). Запись карантина влияет только на
  spec-файл, который она называет, но «Что делаем» оставляет остальные пути приложения на всём наборе — это
  кандидат на отдельный Ticket.

### Что сделано

- `scripts/ci-scope.mjs`: `.github/workflows/` больше не build input целой папкой. `ci.yml` — build input (и путь
  приложения, то есть весь набор e2e), только когда меняется одна из частей, что упаковывают приложение или
  запускают e2e: job-ы `changes`, `macos-e2e`, `macos-package`, `windows-e2e` или ключи до `jobs:` (`on`, `env`,
  `concurrency`, `permissions`). Части сравниваются по тексту ci.yml на BASE и на HEAD (`git show`), без строк
  комментариев и пустых строк (`workflowParts`). Правка job-а `macos-tests` просит только `macos-tests`. ci.yml,
  которого git не показывает на одной из сторон (новый, удалён), — всё, как раньше. `windows-tests.yml` и любой
  другой workflow — не build input и не путь приложения.
- Пути приложения в `test/fixtures/` — только папки, которые читают e2e и их helper-ы (`E2E_FIXTURES`:
  `agent-scripts`, `browser`, `claude-home`, `claude-home-legacy`, `e2e-shell`, `first-run-tools`, `gh`,
  `worfy-mvp-epic`). Остальной `test/fixtures/` (как `eval-stub`) просит `macos-tests` (его читают contract
  test-ы, macOS-only среди них), но не e2e и не `macos-package`.
- `e2eShards` и таблица `scripts/e2e-specs.table.json` не менялись. В `ci.yml` изменён только комментарий о
  `macos-package`; `windows-tests.yml` не менялся.
- Synthetic run на дереве ветки (`EVENT=pull_request BASE=HEAD^1`): только `test/fixtures/eval-stub/claude.cjs` —
  `macos-tests` без e2e и без `macos-package`; только `windows-tests.yml` и только комментарий `ci.yml` — ни одного
  macOS-job-а; job `macos-package` в `ci.yml` — все job-ы и весь набор; только
  `harness/skills/epic-wave/SKILL.md` — 10 spec-файлов, `macos-e2e-shards=["1/1"]`.

### Круг 1 ревью

- `workflowParts` узнаёт ключ job-а с комментарием, anchor-ом или в кавычках после `:`. Строки внутри block
  scalar (`run: |`) — данные, строки `#` и пустые тоже. Job из `changes`, `macos-e2e`, `macos-package`,
  `windows-e2e`, `macos-tests`, которого нет хотя бы на одной стороне, и любой YAML anchor, alias или merge key
  в `ci.yml` дают весь набор и `macos-package`. Contract test проверяет, что каждый job настоящего `ci.yml` — своя
  часть.
- Запись карантина (`test/quarantine/<id>.json`) больше не даёт весь набор: e2e запускают spec-файл из её поля
  `file`, до изменения и после него. Удалённая или нечитаемая запись и запись, которая не называет существующий
  spec-файл, по-прежнему дают весь набор. Триггер #977 закрыт здесь, отдельный Ticket не нужен.
- Guard папок fixture-ов находит папку `test/fixtures` под любым именем переменной, идёт по импортам на любую
  глубину, читает `src/` и падает, когда имя fixture-а лежит в переменной.
- `scripts/affected-tests.mjs`: PR, который добавляет e2e spec, выбирает `ci-workflow.test.ts` (generated scan по
  `test/e2e`). Новая папка fixture-ов даёт ALL. После этого круга PR с правкой `src/` тоже выбирает
  `ci-workflow.test.ts`: guard читает `src/`. Без него было 105 файлов, с ним 106. Отдельная запись в таблице не
  нужна.

Влит #979 (`acd2b50b`), ревью medium в два круга: круг 2 без high и med, 9 из 12 мутантов красные (три выживших —
только в сторону лишнего прогона). Дополнительно: запись в `test/quarantine/` ведёт на spec из своего поля `file`,
а не на весь набор. Пункт «замер после 10 PR» закрыт: замер ниже.
Долг [low] (передан в Ticket 24, следующий PR в `scripts/ci-scope.mjs`): хвост `JOB_KEY`, отступ блока после
`- key: |`, запись карантина для vitest ведёт на весь набор, три недостающих случая test-а.

### Замер после 12 PR с кодом (2026-10-29, около 15:30 UTC)

Выборка — 12 PR с кодом, влитых после #979: #981, #982, #983, #985, #988, #989, #993, #994, #995, #996, #998, #1000.
На каждый — run `ci.yml` на финальном head PR, тот, чей `ci-ok` засчитан для merge. У каждого head ровно один run
`ci.yml`, `run_attempt` 1, `success`; отменённых и повторных run-ов нет.

Метод тот же, что в «Что происходит»: `created_at`, `started_at` и `completed_at` job-ов, только метаданные, без логов.

- **Wall time** — от `created_at` run-а до `completed_at` job-а `ci-ok`.
- **Ожидание macOS** — `started_at − created_at` job-а. По run-у берётся максимум по macOS-job-ам, которые шли
  (`macos-tests`, `macos-e2e (…)`, `macos-package`); skipped-job-ы не считаются. Медиана по job-ам run-а — для справки.
- **Без ожидания** — wall time run-а минус его максимум ожидания macOS. Медиана считается по run-ам. В тексте «до» это
  не уточнено; 31 − 20 = 11 сходится с обоими прочтениями.
- **Весь набор e2e** — два shard-а `macos-e2e (1/2)`, `(2/2)`; `macos-e2e (1/1)` — подмножество. Строку `e2e:` лога
  job-а `changes` не читали. Два shard-а значат, что spec-файлы PR занимают не меньше половины всего времени
  (`e2eShards`). Во всех четырёх таких PR есть `src/main/…`, по файлам PR — путь вне таблицы.

| PR | Run (head) | Создан, UTC | Wall time | Ожидание macOS, медиана / максимум | Без ожидания | `macos-e2e` | `macos-package` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #981 | 40865745284 (`607d53bb`) | 11:29 | 6.9 min | 0.6 / 1.1 min | 5.8 min | `1/1` | skipped |
| #982 | 40873979613 (`e1666510`) | 12:31 | 20.2 min | 13.5 / 16.9 min | 3.4 min | `1/1` | skipped |
| #983 | 40871714045 (`c136bc82`) | 12:15 | 12.4 min | 7.1 / 9.7 min | 2.8 min | `1/1` | skipped |
| #985 | 40870064847 (`2711727c`) | 12:02 | 5.2 min | 0.0 / 0.1 min | 5.2 min | `1/1` | skipped |
| #988 | 40872113898 (`9869e8b4`) | 12:17 | 7.1 min | 5.5 / 5.5 min | 1.6 min | не шёл (только `macos-tests`) | skipped |
| #989 | 40895539978 (`55c68780`) | 14:50 | 13.6 min | 8.3 / 10.4 min | 3.2 min | `1/1` | skipped |
| #993 | 40879802144 (`56a3678c`) | 13:12 | 6.3 min | 0.0 / 0.0 min | 6.2 min | `1/1` | skipped |
| #994 | 40886409816 (`bbf1b3bb`) | 13:55 | 18.0 min | 0.1 / 5.5 min | 12.6 min | `1/2`, `2/2` | skipped |
| #995 | 40887663744 (`1bb57f68`) | 14:03 | 18.4 min | 0.1 / 3.0 min | 15.3 min | `1/2`, `2/2` | skipped |
| #996 | 40893006150 (`081f4537`) | 14:35 | 39.1 min | 17.9 / 20.3 min | 18.8 min | `1/2`, `2/2` | skipped |
| #998 | 40890223163 (`38a3cf60`) | 14:18 | 12.2 min | 10.0 / 10.9 min | 1.2 min | `1/1` | skipped |
| #1000 | 40895545018 (`eaf9b51e`) | 14:50 | 32.4 min | 12.2 / 16.1 min | 16.3 min | `1/2`, `2/2` | skipped |
| **Медиана, n=12** | | | **13.0 min** | **6.3 / 7.6 min** | **5.5 min** | весь набор — 4 PR | 0 PR |
| Медиана без #981 и #985, n=10 | | | 15.8 min | 7.7 / 10.0 min | 4.8 min | весь набор — 4 PR | 0 PR |
| **До 54** (замер 09:30, n=11 run-ов PR) | | | **31 min** | — / **20 min** | **11 min** | шаг 1: 3 из 4 PR | шаг 1: 1 из 4 PR; в 09:30 — 3 PR |

- Run-ы #981 (11:29) и #985 (12:02:41) созданы до merge #979 (12:03:35 UTC). Они шли по старому `ci-scope.mjs`.
  Поэтому есть вторая строка медиан — 10 run-ов по новому правилу.
- Медиана wall time: 31 → 13.0 min (n=12), 15.8 min (n=10). Медиана ожидания macOS: 20 → 7.6 min (n=12),
  10.0 min (n=10). Без ожидания: 11 → 5.5 min (n=12), 4.8 min (n=10).
- Весь набор e2e — 4 из 12 PR (#994, #995, #996, #1000); у всех правка `src/main/…`. `macos-package` — 0 из 12.
  До 54: на шаге 1 весь набор — 3 из 4 PR, `macos-package` — 1 из 4.
- Планка владельца Q4 (медиана wall time PR ≤ 15 min, очередь включена): на n=12 выполнена (13.0 min). На 10 run-ах
  по новому правилу — нет (15.8 min). Run-ов ≤ 15 min — 7 из 12; на n=10 — 5 из 10.
- Что ещё выше планки — очередь macOS, а не длина job-ов. #996 и #1000 ждали 20 и 16 min: в 14:35–14:50 run-ы
  #989, #996 и #1000 стояли в очереди одновременно. Run-ы на всём наборе без ожидания идут 13–19 min.
- Медиана ожидания macOS на n=10 — 10.0 min, ровно на пороге правила 8 владельца (больше 10 min — shard-ы
  unit-test-ов macOS сливаются; `macos-tests` уже один job). Job-ы не на macOS ждут 0–1 min, как и до 54.
- #988 (правка `scripts/ci-scope.mjs`) не запускал `macos-e2e` совсем — только `macos-tests`.

Команды (`GH_TOKEN=$(gh auth token -u IDSAD-XL)`, запросы по одному, без логов):

```
gh pr view <N> -R IDSAD-XL/worfy --json number,headRefOid,mergedAt,mergeCommit,title
gh pr view 979 -R IDSAD-XL/worfy --json mergedAt
gh api "repos/IDSAD-XL/worfy/actions/runs?head_sha=<headRefOid>"
gh api "repos/IDSAD-XL/worfy/actions/runs/<run id>/jobs?per_page=100" --paginate
gh pr view <N> -R IDSAD-XL/worfy --json files    # для #988, #994, #995, #996, #1000
```
