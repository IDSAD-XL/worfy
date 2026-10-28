# 0083 — CI на GitHub-hosted runner-ах на каждый PR и push в `main`; зелёный check `ci-ok` на head — условие merge вместо локального gate full; заменяет ADR-0068
Дата: 2026-10-28. Статус: принят. Вступает в силу с первым зелёным `ci-ok` на `main` — в run-е на push в
`main` после merge PR #870 (CI на каждый PR, `worfy-throughput` 35). До этого момента каждый PR с кодом
вливается по локальному gate full (ADR-0065), даже если у самого PR `ci-ok` уже зелёный, и действуют
ADR-0068, ADR-0069 и ADR-0081.

**Контекст.** Условие merge PR с кодом сейчас — `GATE_SCOPE=all` gate full на Mac: lint, typecheck, весь
`pnpm test`, весь `test:e2e` и `test:package` (около 12 min; `[gate] time (full)` 732,7 s на #860, из них
`test:e2e` 398 s и `test:package` 117 s). Его гоняет Orchestrator на нагруженном Mac (load average 30–60 от
параллельных агентов) под общим замком e2e, по одному набору на Wave (`workflow.merge_gate: "wave"`,
ADR-0065); gate full красный в 13 % run-ов, часть — flaky test-ы под нагрузкой. PR Session на Windows-ПК
с общим кодом ждут своего gate full на Mac в очереди `needs-mac-gate` (ADR-0069). GitHub CI на PR не идёт:
`ci.yml` запускается только вручную, один batch CI run на `main` после Wave (ADR-0068, `workflow.ci:
"batch"`). Вердикт Windows для платформенного PR — run `windows-tests.yml` в режиме `full`, который
Orchestrator запускает руками (ADR-0071), или gate full на ПК владельца (ADR-0056, пункт 2).

Все эти правила держались на цене минут Actions: 2026-10-17 бюджет кончился (ADR-0068), минута macOS-runner-а
в десять раз дороже Linux (ADR-0081, Q4). С 2026-10-27 репозиторий `IDSAD-XL/worfy` публичный, и
GitHub-hosted runner-ы для него бесплатны, в том числе macOS и Windows. Довод цены больше не действует.

PR #870 (`worfy-throughput` 35, ветка `ci/runners-on-every-pr`) запускает `ci.yml` на каждый
`pull_request` и каждый push в `main`: job `changes` (`scripts/ci-scope.mjs` — какие job-ы нужны run-у),
`lint-typecheck` на Linux, `linux-tests` — `pnpm test` в 4 shard-ах на Linux, `macos-tests` и `macos-e2e` —
по 2 shard-а на macOS, `macos-package` — `test:package` на macOS, `windows / full-suite` — весь `pnpm test`
на Windows (`windows-tests.yml` через `workflow_call`), и итоговый job `ci-ok` (`scripts/ci-ok.mjs`). `ci-ok`
зелёный, только когда каждый нужный run-у job зелёный, а каждый ненужный — `skipped`. PR только с
документами получает только `lint-typecheck` и `ci-ok`. Wall time одного run-а — около 25 min (run
40602360006); состав закрепляет `test/contract/ci-workflow.test.ts`.

**Решение** (владелец, 2026-10-28: «Переходим на CI раннеры это приоритет»; тем же днём о Windows — «Full на
каждый PR автоматически»; момент перехода, gate fast и gate full после него, branch protection, вердикт
Windows, очередь `needs-mac-gate`, карантин e2e и предел job-ов macOS — ответ владельца «со всем согласен»
на вопросы Orchestrator-а 2026-10-28).

1. **CI идёт на каждый PR и на каждый push в `main`** на GitHub-hosted runner-ах трёх ОС, в составе PR #870.
   Никогда `pull_request_target`; права токена — только чтение; secrets нет. `workflow.ci` Profile-а worfy —
   `"pr"`, поле `workflow.ci_batch_run` снимается. Ручной запуск `ci.yml` (`job` = `check` или
   `full-macos`) остаётся, но Wave его не запускает.
2. **Условие merge PR — зелёный `ci-ok` на head-коммите PR и отметка агента `review` `success` на том же
   head** (ADR-0067; PR только с документами ревью агентами не проходит — правило глубины ревью в `rules.md`).
   Если база с этого run-а ушла вперёд кодом — rebase, push и новый зелёный `ci-ok`; если только
   документами — нового run-а не нужно (правило владельца 2026-10-20). Красный или отменённый `ci-ok` — merge
   нет.
3. **Flaky test, который краснит `ci-ok`, — в карантин, а не в повтор.** e2e получают тот же карантин, что
   unit- и contract-test-ы (`worfy-throughput` 20): запись с владельцем и сроком не дальше 14 дней, общий
   предел — 15 записей на все виды test-ов. Ручной повтор упавшего job-а — не путь к merge; это заменяет
   для CI правило владельца 2026-10-20 «известный flaky — повторить только упавший шаг». Карантин e2e
   делает отдельный PR.
4. **Локальный gate full не нужен ни одному PR.** `workflow.merge_gate` Profile-а — `null`: `wave-gate` и
   набор Wave (ADR-0065, пункты 1–3 и 5) — не путь по умолчанию. Даёт ли проверка общего дерева набора
   что-то сверх `ci-ok`, оценивает Ticket `worfy-throughput` 07; вернуть набор может только его ADR.
   Implementer по-прежнему гоняет gate fast до PR. gate full и e2e на Mac остаются инструментом
   implementer-а и разбора сбоя — под общим замком e2e и с проверкой экрана, как раньше, — но не условием
   merge и не шагом Orchestrator-а перед merge.
5. **Очереди `needs-mac-gate` больше нет (меняет ADR-0069, пункты 1–4).** Поле `cross_machine_gate`
   снимается из Profile-а worfy на Mac. PR Session на Windows-ПК вливается по зелёному `ci-ok` и отметке
   `review`, как любой другой PR: без gate full на Mac, без раздела «Mac checks» и отчёта по нему. То, что
   проверял gate full на Mac, проверяют job-ы `ci-ok` на macOS. Вливает такой PR по-прежнему Session на Mac
   (ADR-0069, пункт 1).
6. **Вердикт Windows — job `windows / full-suite` в составе `ci-ok` у каждого PR** (меняет ADR-0056, пункты
   1 и 2, и ADR-0071, пункты 2 и 3), в том числе у PR, который меняет сами workflow-ы CI: его run идёт уже с
   изменённым workflow. Отметка `check/windows` (ADR-0067) — `success` на head, где `ci-ok` зелёный. ПК
   нужен только платформенному PR (определение — ADR-0056, пункт 2), для которого
   `node scripts/windows-verdict-scope.mjs <base> <head>` из checkout-а `main` печатает `pc`: такой PR ждёт
   gate full на Windows-ПК владельца на том же head, потому что runner не проверяет Terminal, окна, меню и
   уведомления, e2e и упаковку на Windows. Какие пути дают `pc`, решает список скрипта, а не этот ADR. В PR этого ADR из списка
   ушли `.github/workflows/windows-tests.yml`, сам скрипт и настройка vitest: их проверяет run самого PR
   (скрипт запускается из `main`, настройку vitest runner и ПК гоняют одинаково); остался
   `test/windows-runner.ts` — он называет test-ы, которые runner пропускает, а ПК гоняет.
   Как отметка ставится из run-а автоматически — Ticket `worfy-throughput` 24; gate full на ПК раз в Wave
   вместо каждого PR — Ticket 30 и его ADR. Ручной dispatch `windows-tests.yml` (режимы `files` и `full`)
   Orchestrator больше не запускает: run приходит с `ci-ok`. Ручные режимы остаются для владельца.
7. **Push в `main` заменяет batch CI run** (ADR-0068, пункты 2 и 4; ADR-0081, пункт 4; ADR-0071, run
   `windows-full` на `main` из пункта 2; ADR-0071, пункт 6 — красный run на `main` чинится только вперёд,
   без revert, — заменён последним предложением этого пункта). Каждый merge запускает свой run, и виноватый PR красного `main` виден по run-у
   без деления пополам. Красный `ci-ok` на `main` — новые merge PR с кодом стоят, пока `main` не зелёный;
   исправление — revert виноватого PR или PR с исправлением, по выбору Orchestrator-а, со своим зелёным
   `ci-ok`.
8. **Branch protection у `main`.** Обязательный status check — `ci-ok`. Обязательного ревью GitHub нет:
   ревью — отметка агента `review` (commit status, ADR-0067). Администраторы репозитория могут в аварийном
   случае push-ить в `main` мимо проверки. Включает Orchestrator в момент перехода.

Что остаётся в силе: ADR-0056, пункты 3–6 (ручной job, общение Session-й через репозиторий, merge по одному
с rebase — проверки после rebase теперь `ci-ok`); ADR-0067 (отметки агентов на SHA); ADR-0069, пункт 1 в
части «PR Session на Windows-ПК вливает Session на Mac»; ADR-0071, пункты 1, 4 и 5 (режим `full`, PR со
scope `pc` ждёт ПК, scope решает скрипт); ADR-0081, пункты 5–7 (метрика, бюджет 15/30 min, аудит test-ов); замок e2e `workflow.e2e_lock` и
проверка экрана для локальных run-ов.

**Последствия.**

- Mac больше не держит merge: условие merge проверяют runner-ы, без общего замка e2e и без нагрузки от
  параллельных агентов. Цена — около 25 min wall time run-а на каждый push в PR против около 12 min gate full
  на набор; ответ приходит без участия Orchestrator-а.
- Пока на runner-ах есть красные test-ы, которых нет на Mac (на #870: 27 e2e на macOS из-за экрана runner-а
  1024×768, 7 shell test-ов Harness на Windows из-за `/tmp`, flaky test-ы трёх ОС), `ci-ok` красный у каждого
  PR с кодом. Поэтому решение вступает в силу только с первым зелёным `ci-ok` на `main`; до этого — gate full
  на Mac по ADR-0065, очередь `needs-mac-gate` по ADR-0069 и batch CI по ADR-0068.
- Переход нельзя растянуть: `ci.yml` действует на все PR в момент merge #870, а поля Profile-а — когда их
  прочтёт Harness. Порядок: merge #870; первый зелёный `ci-ok` на push в `main`; затем Orchestrator меняет в
  Profile-е worfy на Mac `workflow.ci` на `"pr"`, снимает `workflow.ci_batch_run` и `cross_machine_gate`,
  ставит `workflow.merge_gate: null`, правит `rules.md` (тексты — в PR этого ADR) и включает branch
  protection у `main` (пункт 8).
- Тексты Harness, которые требуют gate full перед merge (`harness/skills/epic-wave/SKILL.md`,
  `harness/skills/ship-ticket/SKILL.md`, `harness/agents/implementer.md`), читают поля Profile-а: с `ci: "pr"`
  и `merge_gate: null` они уже ждут CI на head и не требуют gate; skill `gate-queue` без `cross_machine_gate`
  не находит очереди. Слова о `ci-ok` в них — отдельная правка Harness (`worfy-throughput` 35, раздел «Где в
  коде»), с платным eval только по «да» владельца.
- На бесплатном плане GitHub одновременно идут не больше 5 job-ов macOS; владелец это принял: неделю после
  перехода меряем ожидание job-ов macOS в очереди, и если медиана больше 10 min, shard-ы `macos-tests`
  сливаются в один job.
- Сбой, который виден только на одной ОС, ловится до merge, а не после Wave.
- Вердикт Windows без ПК получает каждый PR, а не только платформенный: регрессия Windows из PR, который не
  сочли платформенным (ADR-0056, «Последствия»), теперь видна до merge в пределах unit- и contract-test-ов.

## Considered Options

- **Оставить gate full на Mac и batch CI (ADR-0065, ADR-0068, ADR-0081).** Отвергнуто: довод цены ушёл с
  публичным репозиторием, а gate full на нагруженном Mac — самый долгий и самый нестабильный шаг до merge.
- **CI на каждый PR и gate full на Mac перед merge.** Двойная проверка одного и того же; Mac остаётся узким
  местом. Отвергнуто.
- **`ci-ok` на каждый PR как условие merge (выбрано).** Один check на head; Mac и ПК нужны только для того,
  что runner не проверяет (scope `pc`).
- **Merge queue GitHub.** Проверяет дерево после соседних merge-ей, но удлиняет путь каждого PR ещё на один
  run. Не сейчас: если `ci-ok` на `main` будет краснеть от сочетания PR, вопрос вернётся вместе с оценкой
  Ticket-а 07.

## Amendments

- **2026-10-28, один автоматический повтор упавшего test-а в CI** (PR #912). Решено оркестратором без
  владельца 2026-10-28, ждёт подтверждения. Причина: после перехода на runner-ы `ci-ok` зелёный примерно в
  одном CI run-е из трёх, и каждый красный run с 04:33 UTC — flaky test, не связанный с PR; ручной повтор
  job-а не путь к merge, поэтому ничего не вливалось. В CI упавший test повторяется один раз: vitest
  `retry` (`vitest.config.ts`) и Playwright `retries` (`playwright.config.ts`) равны 1, когда задана
  переменная `CI`; локально, в gate fast и gate full, повторов нет. Test, прошедший только со второй
  попытки, — flaky test, и он виден: в логе job-а строка `FLAKY <runner> <файл>:<строка> > <test>` в начале
  строки, `<runner>` — `vitest` или `playwright` (`test/flaky-reporter.ts`, `test/e2e/flaky-reporter.ts`), так
  что `grep '^FLAKY '` по логу job-а находит каждый такой test; в сводке job-а — раздел «Flaky Tests» vitest и
  раздел «Flaky tests (playwright)». Такой test по-прежнему подпадает под правила карантина; 3 строки FLAKY
  одного test-а за неделю — ticket на причину. Ручные повторы job-ов по-прежнему запрещены. Цена: test,
  упавший по пределу времени, в CI идёт дважды — shell test Harness до 120 s лишних на Linux и macOS и до
  900 s на Windows.
- **2026-10-28, job `windows-e2e` — в `ci-ok`, но пока не блокирует** (`worfy-throughput` 44). `pnpm test:e2e` на
  Windows в 4 shard-ах идёт там же, где `macos-e2e`; `ci-ok` печатает его результат, а не зелёный результат
  нужного run-у `windows-e2e` — строка `::warning::` в сводке run-а, не красный `ci-ok` (`NON_BLOCKING` в
  `scripts/ci-ok.mjs`). Ненужный run-у `windows-e2e` по-прежнему должен быть `skipped`. Блокирующим job
  делает отдельный PR после пяти зелёных push-run-ов подряд на `main`.
- **2026-10-28, macOS job-ы PR — по путям diff** (`worfy-throughput` 13, CI-половина; PR ветки
  `ci/macos-jobs-by-diff`). Причина: зелёные run-ы PR шли 57–81 минуту при самом долгом job-е 19 минут —
  macOS job-ы ждали 26–67 минут одного из 5 macOS runner-ов бесплатного плана. Теперь на PR
  (`scripts/ci-scope.mjs`): `macos-e2e` — только когда diff трогает приложение (`src/`, `test/e2e/`, то, что
  e2e импортирует или читает, конфиги сборки, `package.json`, lockfile, workflow-ы); `macos-tests` — тогда же
  или при правке test-файла с проверкой только для macOS, и гоняет только такие файлы (18 из 462, 179 s из
  1131 s); `macos-package` — как раньше, по входам сборки. PR только с Harness, unit/contract test-ами или
  другими скриптами не просит ни одного macOS job-а. Push в `main` гоняет все job-ы, весь набор в каждом.
  Красный run push-а в `main` чинится первым, по правилу этого ADR для красного `ci-ok` на `main`.
