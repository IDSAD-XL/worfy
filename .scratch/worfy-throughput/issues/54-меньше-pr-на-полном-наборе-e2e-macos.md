# 54 — Меньше PR на полном наборе e2e macOS: узкие триггеры полного набора и `macos-package`

Type: task
Status: open
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

- [ ] «Итог»: замер шага 1 — run-ы после `87b87f6a`, путь-триггер каждого PR на всём наборе и на `macos-package`.
- [ ] Сначала красные contract test-ы (a) и (b): PR только с `test/fixtures/eval-stub/claude.cjs` не идёт на весь
      набор; PR только с `.github/workflows/windows-tests.yml` не просит `macos-package`. Старые ожидания
      `test/contract/ci-workflow.test.ts:596-597` и `:663` переписаны под новое правило.
- [ ] Test: PR только с `harness/skills/epic-wave/SKILL.md` просит только spec-файлы правила Harness таблицы, и по
      нынешнему правилу shard-ов это `macos-e2e-shards=["1/1"]`. Сегодня он зелёный сразу — это guard, а не
      красный test.
- [ ] Test: каждая папка fixture-ов, которую читает e2e, остаётся путём приложения.
- [ ] `pnpm lint`, `pnpm typecheck` и `pnpm test` — exit 0; условие merge — `ci-ok`.
- [ ] Замер после 10 PR с кодом (тем же методом: медиана времени по стене, медиана ожидания macOS, время без
      ожидания, сколько PR шли на всём наборе и с `macos-package`) — в «Итог».
- [ ] Вердикт Windows: runner (`scripts/windows-verdict-scope.mjs`). `windows-tests.yml` этот Ticket не меняет; если
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
