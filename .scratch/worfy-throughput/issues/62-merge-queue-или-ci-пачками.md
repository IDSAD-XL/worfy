# 62 — Merge queue или CI пачками: замер и рекомендация

Type: task
Status: done 2026-11-09T09:44Z
PR: #1725
Branch: worfy-throughput/62
Blocked by: 05
Source: решение владельца 2026-11-09, Q6 (по «Итог» Ticket-а 05): «да» GitHub merge queue — или вариант владельца
«не гонять CI попусту, копить коммиты, и все вместе гонять уже большими пачками»; «да» — `critical-path` читает
commit status `review` как отметку Gate.

## Что происходит

- Повторный замер Ticket-а 05: Σ Gate → merge на Wave выросла в двух Wave-ах из четырёх. PR Wave-а вливаются по
  одному: база ушла вперёд кодом — rebase, push и новый зелёный `ci-ok` (правило merge, ADR-0083), 20–40 min на PR.
- 60 из 222 PR без комментария VERIFIED: отметка ревью стала commit status `review`, и шаг Gate для них
  `scripts/critical-path.mjs` не меряет.

## Что делаем

Это Ticket проектирования и замера: настройки репозитория, branch protection и поведение CI не меняются (это
Ticket-ы после того, как владелец прочтёт сравнение).

1. Факты из первоисточников: доступность GitHub merge queue для публичного репозитория пользователя, событие
   `merge_group` для `ci.yml` и `windows-tests.yml`, обязательные checks, пачки, связь с `bin/land` и
   `bin/wave-gate` Harness-а; что значит `workflow.ci: batch` сейчас.
2. Замер по истории (gh API, последние ~150 влитых PR): минуты CI на head PR, число head-ов на PR (rebase-ы),
   ожидание от отметки `review` до merge, доля PR только с документами, которые всё равно гоняли CI, холостой CI.
3. Оценка вариантов: A) merge queue (пачка 3–5), B) CI пачкой на Wave на `main` с планом revert/bisect при красном,
   C) как сейчас + пропуск CI для PR только с документами. Влияние на Gate → merge Wave-а, минуты CI, риск красного
   `main`, вердикт Windows для платформенных PR, правки скриптов Harness.
4. Рекомендация с числами и Ticket-ы, которые из неё следуют.
5. `critical-path` и commit status `review` как отметка Gate: проверить, что status ставится в момент вердикта; если нет —
   не читать его и назвать, что для этого нужно сначала.

## Готово, когда

- [ ] «Итог» называет факты о merge queue со ссылками на docs.github.com и что из них следует для этого репозитория.
  - evidence: commit pass · ticket 62 Итог section 1: merge queue facts with docs.github.com links; owner.type User via gh api exit 0 · - - · d1a2078cbd422e3507cdc3df329e1e9fc4939a7d
- [ ] «Итог» — таблица замера по истории: команды и их exit code, выборка и период.
  - evidence: commit pass · ticket 62 Итог section 2: 150 merged PRs 2026-11-07..09, gh api reads exit 0 · - - · d1a2078cbd422e3507cdc3df329e1e9fc4939a7d
- [ ] «Итог» — оценка A/B/C по пяти осям и рекомендация с числами; список Ticket-ов-продолжений (заголовок + строка).
  - evidence: commit pass · ticket 62 Итог sections 3-5: A/B/C table, recommendation B, six follow-ups · - - · d1a2078cbd422e3507cdc3df329e1e9fc4939a7d
- [ ] `critical-path` не читает status `review`: сейчас он ставится в момент merge, а не в момент вердикта; сначала
      продолжение 5 (ставить `review` в момент вердикта), потом чтение.
  - evidence: commit pass · measurement: review status to merge median 0.2 min on 67 PRs; review round 1 finding: Green to merge collapsed to 0; Итог section 6, follow-up 5 · - - · 7d6af5e3a8e2ba50d6521a0d0a8bf13947ac8b93
- [x] Владелец прочёл рекомендацию (вручную).
  - evidence: owner-check pass · owner 2026-11-09 read the Итог and answered «да» to Q1 (option B), Q2 (no merge queue, threshold 2 red mains a week), Q4 (rebase only on conflict), Q5 (red main rule), Q6 (new ADR-0103) · mac stable · 907b93cd2016504a89ded66b5e7d2e8e8e7e1dd2

## Тесты

Кода нет: только замер. Правка `scripts/critical-path.mjs` из первого круга отозвана ревью (см. «Итог», часть 6).

## Где в коде

— (только чтение: `scripts/critical-path.mjs`, `src/shared/flight-recorder/pr-facts.mjs`, `.github/workflows/ci.yml`, `.github/workflows/windows-tests.yml`, `harness/bin/land`,
  `harness/bin/wave-gate`, `harness/skills/epic-wave/SKILL.md`, `harness/profiles/README.md`)

## Вне скоупа

- Включение merge queue, rulesets, branch protection, правки workflow-ов CI и профиля — Ticket-ы-продолжения.

## Итог

Замер 2026-11-09. Настройки репозитория, branch protection и CI не менялись; все вызовы GitHub API — только чтение.

### 1. Факты

- **Merge queue этому репозиторию недоступна.** `gh api repos/IDSAD-XL/worfy --jq .owner.type` → `User` (exit 0).
  Docs GitHub: «Pull request merge queues are available in any public repository owned by an organization, or in
  private repositories owned by organizations using GitHub Enterprise Cloud»
  (docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/merging-a-pull-request-with-a-merge-queue).
  В списке правил ruleset-ов для Free/Pro/Team «Require merge queue» нет. Путь один — передать репозиторий в
  организацию (бесплатная организация подходит: репозиторий публичный); превращение аккаунта пользователя в
  организацию GitHub закрыл 2026-01-12 (github.blog/changelog/2026-01-12-deprecation-of-user-to-organization-account-transformation).
- Что понадобилось бы для merge queue: `on: merge_group` (`types: [checks_requested]`) в `ci.yml` — иначе
  обязательный `ci-ok` не придёт и очередь не вольёт PR; `windows-tests.yml` идёт через `workflow_call` из `ci.yml`
  и своего trigger-а не требует. Пачка: «build concurrency» (сколько групп строится параллельно, каждая включает
  PR перед ней), «merge limits» (min/max PR на merge) и время ожидания минимальной группы; упавшая группа — PR
  убирается из очереди, остальные пересобираются без него. Checks требуются на commit-е группы (другой SHA):
  commit status `review` на head PR его не покрывает; сейчас `review` не обязательный check GitHub, а условие
  Harness-а, и это не мешает. `gh pr merge` на ветке с очередью ставит PR в очередь.
- **Branch protection сейчас:** обязательный только `ci-ok`, `strict: false` (GitHub не требует свежей базы),
  ruleset-ов нет (`gh api repos/IDSAD-XL/worfy/branches/main/protection`, `…/rulesets`, exit 0). Rebase на свежую
  базу требует только правило проекта: «база ушла вперёд кодом после run-а — rebase, push и новый зелёный `ci-ok`»
  (`rules-merge.md`, ADR-0083).
- **Harness:** `bin/land` вливает по одному PR (`gh pr merge --squash --match-head-commit`), сам ничего не
  rebase-ит, PR в `BEHIND`/`DIRTY` ждёт. `workflow.ci: batch` (ADR-0068, заменён ADR-0083) — CI не идёт на PR,
  `bin/wave-gate ci` запускает один CI run на `main` после Wave; при красном — остановка run-а Autopilot и fix
  вперёд, без revert и без деления пополам. `bin/wave-gate check/merge` (ADR-0065) — merge набора с одним gate full
  и делением пополам — после R2-Q3 не используется. Профиль worfy: `workflow.ci: "pr"`, `merge_gate: null`.
- **PR только с документами уже не гоняют test-ы:** `scripts/ci-scope.mjs` оставляет им `lint-typecheck` и `ci-ok`.

### 2. Замер по истории

Выборка: последние 150 влитых PR (#1573…#1722), merge 2026-11-07 09:03Z … 2026-11-09 08:41Z (47,6 h), 454 CI
run-а; 64 PR с кодом, 86 — только документы. Команды: `gh pr list --repo IDSAD-XL/worfy --state merged --limit 150
--json …`, `gh api --paginate repos/IDSAD-XL/worfy/actions/runs?created=>=2026-11-07`, `…/runs/<id>/jobs`,
`…/commits/<sha>/statuses`, `…/compare/<a>...<b>` — exit 0 у всех. Минуты — машинные (сумма job-ов), min.

| Что | Число |
| --- | --- |
| Head-ов на PR с кодом | медиана 2, p90 3; у 46 из 64 больше одного |
| Смены head-а | 75: 41 commit сверху (исправления), 34 rebase/force-push |
| Rebase зелёного head-а (по-видимому, ради свежей базы: замер видит только «head разошёлся после зелёного run-а», такой rebase мог нести и правку кода) | 21 head, 1 823 min CI; новый `ci-ok` — медиана 26,3, p90 71,8 min wall |
| Чем кончился CI после такого rebase | 18 зелёных, 2 отменены, 1 красный (#1632, Windows test, исправлен commit-ом сверху; skew это или ошибка PR — не различить) |
| Минуты CI на PR (все) | 13 809 min; 6 905 (50 %) — на head-ах, которые потом заменили |
| CI на PR с кодом | медиана 192,8 min на PR (p90 410,8), из них на заменённых head-ах 90,3 |
| Отменённые run-ы | 35, 3 026 min |
| `ci-ok` на последнем head-е PR с кодом | медиана 24,7, p90 62,1 min wall; последний job по ОС: Linux 3,0, Windows 11,7, macOS 24,4 (p90 63,2) |
| Зелёный `ci-ok` → merge (PR с кодом) | медиана 3,0, p90 22,9 min |
| Первый run последнего head-а → merge | медиана 30,5, p90 85,2 min |
| Только документы | 86 PR, 2,9 min CI на run, 285 min всего (2 % минут PR); открытие → merge медиана 5,2 min |
| Push в `main` | 180 run-ов, из них 77 с кодом: 158 min CI на run, 11 869 min всего; wall медиана 36,5, p90 241,6 min |
| Красный `main` | 14 из 77 run-ов с кодом (18,2 %), одна серия из 9 (2026-11-08 05:44–11:30Z, macOS); падали macos-e2e 12, linux-tests 7, macos-tests 7, macos-package 6, windows 5 |
| Очередь macOS runner-а | push: медиана 5,3, p90 212 min (до 259); PR: 2,1 / 30,7 min |
| Windows | 65 PR, 98,8 min на PR (p90 222,3), 7 576 min |

Не измерено: ожидание от решения ревью до merge — commit status `review` ставится за 10–15 s до merge (67 PR,
медиана 0,2 min), время самого решения нигде не записано; окно короткое (двое суток плотной работы); у двух PR
список файлов обрезан на 100 (#1689, #1692), они посчитаны как PR с кодом.

### 3. Варианты

Wave из 5 PR с кодом, готовых почти одновременно; числа — из таблицы выше.

| | A. Merge queue, пачка 3–5 | B. Без rebase на PR, проверка — run на `main` | C. Как сейчас + пропуск CI для документов |
| --- | --- | --- | --- |
| Можно ли сейчас | нет: нужна передача репозитория в организацию | да | уже сделано (`ci-scope.mjs`) |
| Gate → merge на Wave | один run группы ≈ 25–37 min (p90 до ~240 из-за очереди macOS) | 5 merge подряд ≈ 5 × 3 = 15 min | 4 rebase × 26 min ≈ 105 min (p90 ≈ 290) |
| Минуты CI | без rebase-ов (−1 823 min за 48 h); push-run-ы на `main` можно убрать (−11 869), зато +1 run на группу (≈16 × 158 ≈ 2 500) | −1 823 min за 48 h; push-run-ы остаются | 0 (остаток выигрыша — меньше 285 min) |
| Риск красного `main` | ниже всех: группа проверена на commit-е merge-а; flaky macOS e2e выбивает PR из очереди | skew доходит до `main`; за 48 h rebase поймал не больше 1 случая из 21. Виден он поздно: push-run с кодом — медиана 36,5 min, p90 241,6 min (очередь macOS), и к его концу сверху влиты другие PR. Правило красного `main` (fix за 1 h, потом revert) тогда требует шага поиска виноватого по push-run-ам каждого commit-а | как сейчас: 18,2 % красных run-ов с кодом, в основном flaky macOS |
| Поиск виноватого | очередь сама убирает PR | push-run есть на каждом commit-е (`concurrency` по SHA): первый красный run называет PR, деления пополам не нужно | — |
| Вердикт Windows | job Windows на head PR и в группе | job Windows на head PR, как сейчас (rebase его не трогал) | как сейчас |
| Правки | передача репозитория, ruleset, `merge_group` в `ci.yml` и база diff для `ci-scope.mjs`, `bin/land` ставит PR в очередь и ждёт её, `github.account` профиля | правило в `rules-merge.md` и ADR-0083, текст `epic-wave` о rebase, `bin/land` — проверить, что `BEHIND` при `strict: false` не приходит | нет |

Вариант владельца «копить коммиты и гонять пачками» буквально — `workflow.ci: batch` (ADR-0068): CI не идёт на PR.
Он теряет вердикт Windows на head PR (правило владельца: вердикт — job Windows в CI) и проверку до ревью, а
красный `main` при нём ищется заново. Поэтому B — его мягкая форма: CI на первом head-е PR остаётся, пачкой
проверяется только сочетание PR — run-ом на `main` после merge-ей.

### 4. Рекомендация

**B сейчас, A — только если skew-ов станет больше одного в неделю** (порог из spec-а, R2-Q3).

- B убирает то, что замер Ticket-а 05 назвал причиной: rebase и новый `ci-ok` на каждый PR после первого.
  На Wave из 5 PR Gate → merge ≈ 15 min вместо ≈ 105 min (p90 ≈ 290), минус ≈ 1 800 min CI за двое суток.
  Цена — skew виден после merge, а не до: за 48 h это не больше одного случая на 21 rebase.
- A даёт и скорость, и чистый `main`, но требует передачи репозитория в организацию — это решение владельца
  (новый URL с redirect-ом, права токена, перенос branch protection), и очередь чувствительна к flaky macOS e2e.
- C больше ничего не даёт: пропуск для документов уже работает, их CI — 2 % минут.
- Отдельно: узкое место CI — macOS (последний job `ci-ok` 24,4 min, очередь push-run-ов p90 212 min при 5
  бесплатных macOS runner-ах). Его не решает ни один из трёх вариантов.

### 5. Ticket-ы-продолжения

1. **Merge без rebase ради свежей базы** — правило `rules-merge.md` и поправка ADR-0083: PR с зелёным `ci-ok`
   на своём head-е и без конфликта вливается, даже если `main` ушёл вперёд кодом; проверка сочетания — push-run на `main`.
2. **`bin/land` и `epic-wave` без rebase на `BEHIND`** — проверить поведение `mergeStateStatus` при `strict: false`,
   убрать из `epic-wave` шаг «rebase при сдвинутой базе» под полем профиля; shell test. Платформенный PR.
3. **Виноватый в красном `main` по push-run-ам** — `epic-wave`/Orchestrator: первый красный push-run после
   серии merge-ей называет PR; затем fix за 1 h или revert (правило уже есть, нужен шаг поиска).
4. **Замер через неделю после 1–3** — Σ Gate → merge на Wave, красные push-run-ы с кодом, число skew-ов; порог
   «больше одного skew в неделю» → вопрос владельцу о варианте A.
5. **Status `review` в момент вердикта** — ставить его, когда ревью вынесло вердикт, а не перед merge (сейчас за
   10–15 s до merge); после этого `critical-path` читает его как Gate, с test-ом.
6. **(вопрос владельцу) Передача репозитория в организацию ради merge queue** — только если п. 4 покажет skew-ы.

### 6. `critical-path` и status `review`

Не сделано, и это решение: `critical-path` status `review` пока не читает. Сейчас status `review` ставится в момент
merge (67 PR выборки: от `review` до merge медиана 0,2 min), а не в момент вердикта ревью. Прочитанный как Gate, он
дал бы Gate → merge ≈ 0, а через отметку «зелёно» (позднее из Gate и зелёного CI) — и Green → merge с бюджетом ≈ 0
(«в бюджете»), то есть ноль там, где данных нет; это нарушает правило отчёта «шаг без данных — пустая ячейка с
причиной». Правка первого круга (PR #1725) это и показала: ночной PR #468 в эталонном отчёте получил Green → merge
18 s «in budget»; ревью отклонило её, правка отозвана. Ожидание ревью при таком чтении ушло бы в шаг CI → Gate, но
только когда `gh run list` отдаёт run-ы ветки; без них отметка CI берётся из `statusCheckRollup` head-а, где лежат и
сами `review` и `check/windows`, и шаг тоже схлопнулся бы.

Порядок: сначала продолжение 5 — ставить `review` в момент вердикта; потом `critical-path` читает его как Gate (тогда
пара строк в `measure()` и test).

## Решение владельца 2026-11-09

Владелец прочёл «Итог» и ответил «да» на все пять вопросов. Решение записано в
[ADR-0103](../../../docs/adr/0103-merge-without-rebase-for-a-fresh-base.md); Ticket-ы-продолжения — 63–66.

- **Q1 — вариант B.** PR, у которого на его собственном head зелёный `ci-ok` и нет конфликта, вливается без rebase
  ради свежей базы. Сочетание PR проверяет push-run на `main` после merge.
- **Q2 — merge queue нет.** Репозиторий не переходит в организацию GitHub ради merge queue (она есть только у
  организаций, владелец репозитория — `User`). Вопрос возвращается, только если при варианте B за одну неделю будет
  2 или больше красных `main` от несовместимых PR (замер — Ticket 66).
- **Q4 — rebase только при конфликте.** Rebase нужен, только когда GitHub сообщает конфликт (`CONFLICTING` или
  `DIRTY`). Других исключений нет: платформенный PR тоже вливается без rebase, его Windows verdict — job Windows в
  составе `ci-ok` на его собственном head.
- **Q5 — красный `main`.** Виноватый PR — тот, чей commit дал первый красный push-run на `main`. Пока `main`
  красный, PR с кодом не вливаются, PR только с документами — вливаются. Исправление вперёд — не дольше 1 h,
  потом revert виноватого PR. Сбой, который проходит при одном повторе упавших job-ов (правило «один повтор на
  head»), — flaky test, а не вина PR.
- **Q6 — новый ADR.** ADR-0103 частично заменяет ADR-0083: зелёный `ci-ok` на каждом PR остаётся условием merge,
  уходит только требование rebase ради свежей базы.

Продолжения из «Итог», часть 5, в Ticket-ах: 1 — ADR-0103 (этот PR; `rules-merge.md` Profile-а правит Orchestrator);
2 — Ticket 63; 3 — Ticket 64; 4 — Ticket 66; 5 — Ticket 65; 6 — не нужен по Q2, пока порог не пройден.
