# 0083 — CI на GitHub-hosted runner-ах на каждый PR и push в `main`; зелёный check `ci-ok` на head — условие merge вместо локального gate full; заменяет ADR-0068
Дата: 2026-10-28. Статус: принят. Вступает в силу, когда влит PR #870 (CI на каждый PR, `worfy-throughput` 35) и
первый run на push в `main` после него дал зелёный `ci-ok`; до этого действуют ADR-0068 и ADR-0081.

**Контекст.** Условие merge PR с кодом сейчас — `GATE_SCOPE=all` gate full на Mac: lint, typecheck, весь
`pnpm test`, весь `test:e2e` и `test:package` (около 12 min; `[gate] time (full)` 732,7 s на #860, из них
`test:e2e` 398 s и `test:package` 117 s). Его гоняет Orchestrator на нагруженном Mac (load average 30–60 от
параллельных агентов) под общим замком e2e, по одному набору на Wave (`workflow.merge_gate: "wave"`,
ADR-0065); gate full красный в 13 % run-ов, часть — flaky test-ы под нагрузкой. GitHub CI на PR не идёт:
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
каждый PR автоматически»).

1. **CI идёт на каждый PR и на каждый push в `main`** на GitHub-hosted runner-ах трёх ОС, в составе PR #870.
   Никогда `pull_request_target`; права токена — только чтение; secrets нет. `workflow.ci` Profile-а worfy —
   `"pr"`, поле `workflow.ci_batch_run` снимается. Ручной запуск `ci.yml` (`job` = `check` или
   `full-macos`) остаётся, но Wave его не запускает.
2. **Условие merge PR — зелёный `ci-ok` на head-коммите PR и отметка агента `review` `success` на том же
   head** (ADR-0067; PR только с документами ревью агентами не проходит — правило глубины ревью в `rules.md`).
   Если база с этого run-а ушла вперёд кодом — rebase, push и новый зелёный `ci-ok`; если только
   документами — нового run-а не нужно (правило владельца 2026-10-20). Красный или отменённый `ci-ok` — merge
   нет. Flaky test, который краснит `ci-ok`, уходит в карантин (`worfy-throughput` 20), а не в автоматический
   повтор; ручной повтор только упавшего job-а Orchestrator-ом остаётся (правило владельца 2026-10-20).
3. **Локальный gate full перед merge больше не нужен.** `workflow.merge_gate` Profile-а — `null`:
   `wave-gate` и набор Wave (ADR-0065, пункты 1–3) — не путь по умолчанию. Даёт ли проверка общего дерева
   набора что-то сверх `ci-ok`, оценивает Ticket `worfy-throughput` 07; вернуть набор может только его ADR.
   PR с меткой `needs-mac-gate` (ADR-0069) тоже вливается по `ci-ok`: его job-ы на macOS проверяют то же, что
   gate full на Mac. Метка по-прежнему говорит, какая Session вливает PR. gate full и e2e на Mac остаются
   инструментом implementer-а и Orchestrator-а для разбора сбоя — под общим замком e2e и с проверкой экрана, как
   раньше, но не условием merge.
4. **Вердикт Windows (меняет ADR-0056, пункты 1 и 2, и ADR-0071, пункты 2–4).** Windows-runner на PR есть:
   job `windows / full-suite` в составе `ci-ok` — вердикт Windows для каждого PR. Отметка `check/windows`
   (ADR-0067) — `success` на head, где `ci-ok` зелёный, для обычного PR и для платформенного, для которого
   `node scripts/windows-verdict-scope.mjs <base> <head>` из checkout-а `main` печатает `runner`.
   Платформенный PR (определение — ADR-0056, пункт 2), для которого scope печатает `pc`, по-прежнему ждёт
   gate full на Windows-ПК владельца на том же head: runner не проверяет Terminal, окна, меню и уведомления,
   e2e и упаковку на Windows. Как отметка ставится из run-а автоматически — Ticket `worfy-throughput` 24;
   gate full на ПК раз в Wave вместо каждого PR — Ticket 30 и его ADR. Ручной dispatch `windows-tests.yml`
   (режимы `files` и `full`) Orchestrator больше не запускает: run приходит с `ci-ok`. Ручные режимы
   остаются для владельца.
5. **Push в `main` заменяет batch CI run** (ADR-0068, пункты 2 и 4; ADR-0081, пункт 4; ADR-0071, run
   `windows-full` на `main`). Каждый merge запускает свой run, и виноватый PR красного `main` виден по run-у
   без деления пополам. Красный `ci-ok` на `main` — новые merge PR с кодом стоят, пока `main` не зелёный;
   исправление — revert виноватого PR или PR с исправлением, по выбору Orchestrator-а, со своим зелёным
   `ci-ok`.

Что остаётся в силе: ADR-0056, пункты 3–6 (ручной job, общение Session-й через репозиторий, merge по одному
с rebase — проверки после rebase теперь `ci-ok`); ADR-0067 (отметки агентов на SHA); ADR-0069 (кто вливает PR
Session Windows); ADR-0071, пункты 1 и 5 (режим `full`, scope решает скрипт); ADR-0081, пункты 5–7 (метрика,
бюджет 15/30 min, аудит test-ов); замок e2e `workflow.e2e_lock` для локальных run-ов.

**Последствия.**

- Mac больше не держит merge: условие merge проверяют runner-ы, без общего замка e2e и без нагрузки от
  параллельных агентов. Цена — около 25 min wall time run-а на каждый push в PR против около 12 min gate full
  на набор; ответ приходит без участия Orchestrator-а.
- Пока на runner-ах есть красные test-ы, которых нет на Mac (на #870: 27 e2e на macOS из-за экрана runner-а
  1024×768, 7 shell test-ов Harness на Windows из-за `/tmp`, flaky test-ы трёх ОС), `ci-ok` красный у каждого
  PR с кодом. Поэтому решение вступает в силу только с первым зелёным `ci-ok` на `main`; до этого — gate full
  на Mac по ADR-0065 и batch CI по ADR-0068.
- Переход нельзя растянуть: `ci.yml` действует на все PR в момент merge #870, а поля Profile-а — когда их
  прочтёт Harness. Порядок: merge #870; зелёный `ci-ok` на push в `main`; Orchestrator меняет в Profile-е
  worfy `workflow.ci` на `"pr"`, снимает `workflow.ci_batch_run`, ставит `workflow.merge_gate: null` и
  правит `rules.md` (тексты — в PR этого ADR).
- Тексты Harness, которые требуют gate full перед merge (`harness/skills/epic-wave/SKILL.md`,
  `harness/skills/ship-ticket/SKILL.md`, `harness/agents/implementer.md`, skill `gate-queue`), читают поля
  Profile-а: с `ci: "pr"` и `merge_gate: null` они уже ждут CI на head и не требуют gate. Слова о `ci-ok` в
  них — отдельная правка Harness (`worfy-throughput` 35, раздел «Где в коде»), с платным eval только по «да»
  владельца.
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
- **Merge queue GitHub.** Проверяет дерево после соседних merge-ей, но без branch protection у `main` её
  нет, и она удлиняет путь каждого PR ещё на один run. Не сейчас: если `ci-ok` на `main` будет краснеть от
  сочетания PR, вопрос вернётся вместе с оценкой Ticket-а 07.
