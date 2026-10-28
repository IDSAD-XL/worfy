# 35 — Каждый PR и каждый push в `main` проверяются на GitHub-hosted runner-ах; check `ci-ok` — условие merge вместо локального gate full

Type: task
Status: done 2026-10-28T06:22Z
PR: #870
Branch: ci/runners-on-every-pr
Blocked by: —
Source: решение владельца 2026-10-28 «Переходим на CI раннеры, это приоритет» ([spec.md](../spec.md), раздел
«Решения владельца 2026-10-28: процесс», решение 0, Wave 0); репозиторий `IDSAD-XL/worfy` публичный с
2026-10-27 — GitHub-hosted runner-ы для него бесплатны, в том числе macOS и Windows.

## Что происходит

- Условие merge PR с кодом — gate full на Mac (`GATE_SCOPE=all`, около 12 min; `[gate] time (full)` 732,7 s на
  #860, из них `test:e2e` 398 s и `test:package` 117 s). Его гоняет Orchestrator на нагруженном Mac (load
  average 30–60 от параллельных агентов), под общим замком e2e; gate full красный в 13 % run-ов, часть — flaky
  test-ы под нагрузкой.
- `.github/workflows/ci.yml` — только `workflow_dispatch` (batch CI на `main`, ADR-0068); job-ов на macOS на PR
  нет (ADR-0056, пункт 1; ADR-0081, Q4). `windows-tests.yml` — только `workflow_dispatch` (ADR-0071).
- Довод цены за всем этим больше не действует: публичный репозиторий не платит за минуты GitHub-hosted runner-ов.

## Что делаем

1. Триггеры `pull_request` и `push` в `main` (никогда `pull_request_target`; права токена — только чтение).
2. Linux (`ubuntu-latest`): lint, typecheck, unit- и contract-test-ы shard-ами.
3. macOS: `test:e2e` и `test:package`.
4. Windows: режим `full` (`pnpm test`).
5. Один итоговый check `ci-ok`: зелёный, только когда зелены все job-ы выше. Он заменяет локальный gate full
   как условие merge; тексты Harness и правила Profile-а, которые требуют gate full перед merge, переходят на
   `ci-ok`.
6. ADR (номер — `bin/preflight` на claim): что заменяется в ADR-0056 (пункт 1), ADR-0065, ADR-0068, ADR-0071 и
   ADR-0081 (Q4: job-ов на macOS нет); в конец каждого из них — `## Amendments` одной датированной строкой.

Точный состав job-ов, число shard-ов и пределы времени — у implementer-а этого Ticket-а (работа идёт); при
расхождении с этим текстом прав PR, а «Итог» называет расхождение.

Нужен ПК: нет для работы. Вердикт Windows этого PR: если он меняет файлы из `PC_ONLY`
(`.github/workflows/windows-tests.yml`, `vitest.config.ts`, `package.json`, `playwright.config.ts`), scope —
`pc`; принять ли вместо gate full на ПК его собственный зелёный `ci-ok` — решает владелец. Трогает Harness: да
(тексты о gate перед merge); слово владельца — решение 2026-10-28.

## Готово, когда

- [ ] PR этого Ticket-а сам получил run-ы на трёх ОС и `ci-ok`; ссылки и время каждого job-а — в «Итог».
- [ ] Push в `main` после merge запустил тот же набор; ссылка в «Итог».
- [ ] Contract test-ы workflow-ов закрепляют триггеры, отсутствие `pull_request_target`, права только на
      чтение и состав `ci-ok`; exit 0.
- [ ] Тексты Harness и правило Profile-а о merge говорят `ci-ok` вместо gate full; shell test-ы Harness — exit 0.
- [ ] Flaky test-ы, которые краснят runner-ы, записаны в карантин Ticket-а 20 (или ждут его), а не
      повторяются автоматически; список — в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Где в коде

- `.github/workflows/` (`ci.yml`, `windows-tests.yml` или новый файл), contract test-ы workflow-ов в `test/contract/`
- `harness/skills/epic-wave/SKILL.md`, `harness/skills/ship-ticket/SKILL.md`, `harness/agents/implementer.md` —
  условие merge
- `docs/adr/<новый>` и `## Amendments` в ADR-0056, 0065, 0068, 0071, 0081
- Дописать при claim по PR

Вне репозитория (Orchestrator после merge): `rules.md` Profile-а worfy — пункт «Gate перед мержем PR с кодом»;
шаг владельца — Settings → Actions → General: одобрение run-ов из fork-ов внешних участников.

## Вне скоупа

- Вердикт `check/windows` из run-а и правила для scope `runner` — Ticket 24.
- Нужен ли `wave-gate` после `ci-ok` — оценка в Ticket-е 07.
- gate full на ПК для scope `pc` — Ticket 30.

## Итог

- PR #870: `.github/workflows/ci.yml` запускается на `pull_request` и `push` в `main` (без `pull_request_target`,
  токен только на чтение, `persist-credentials: false` на каждом checkout, `pnpm/action-setup` закреплён по SHA).
  Job-ы: `changes` (`scripts/ci-scope.mjs`: PR только с документами получает лишь `lint-typecheck`),
  `lint-typecheck`, `linux-tests` (4 shard-а), `macos-tests` (2), `macos-e2e` (2), `macos-package`,
  `windows / full-suite` и итоговый `ci-ok`. Push-run-ы `main` получают concurrency-группу по commit-у и не
  отменяют друг друга. Contract test-ы `test/contract/ci-workflow.test.ts` и `windows-tests-workflow.test.ts`.
- Довести `ci-ok` до зелёного на runner-ах понадобилось пять follow-up PR: #875 (Git Bash находит `/tmp` на
  Windows runner-е), #874 (e2e проходят на экране macOS runner-а 1024×768), #877 (исправления и записи
  карантина), #878 (карантин e2e общий с карантином vitest), #879 (повторный просмотр папки registry, если
  FSEvents потерял событие). #876 — ADR-0083: условие merge — `ci-ok` вместо локального gate full; тексты
  Harness и Profile-а переведены на `ci-ok`.
- Первый зелёный push-run на `main` — [40640810358](https://github.com/IDSAD-XL/worfy/actions/runs/40640810358)
  (`c43e9648`, после #878), 24 min от начала до `ci-ok`: `lint-typecheck` 2 min, `linux-tests` 2–4 min,
  `macos-tests` 5–6 min, `macos-package` 3 min, `macos-e2e` 13 и 19 min, `windows / full-suite` 15,5 min.
  Push-run-ы #870…#877 на `main` были красными — их и чинили follow-up PR. Собственный run PR #870 с
  Windows — 40606669326.
- Карантин (Ticket 20) — 14 записей, владелец всех новых — Ticket 23: к шести записям #873 добавлены
  `demo-template-careless-done`, `demo-template-reference-done`, `harness-evals-budget-rounding`,
  `harness-evals-changed-no-case`, `harness-wave-gate-lock-killed`, `orchestrator-relaunch-message-during-wait`,
  `orchestrator-relaunch-sigterm-ignored`, `workflow-watch-links-same-link` (`test/quarantine/`). Автоматических
  повторов нет.
- Расхождение с «Что делаем»: Windows-test-ы e2e на runner-е не идут — это Ticket 36.
- Долг (low, из VERIFIED-комментариев): `wave-gate-heartbeat` — timed trap 1234 ms против предела 1200 на
  macOS runner-е (run 40628079155, #877); нет test-а на пропущенный `clearInterval` у повторного просмотра
  registry, `ready` не ждёт первого снимка (#879); метка цикла без `when` проходит `quarantine.test.ts` (#878);
  `start-budget.ts:20-22` приводит два разных диапазона одних замеров (#874); комментарий
  `global-setup-git-bash.ts:22` говорит «refuses», а код отклоняет (#875); HANDOFF говорил о переходе в
  настоящем времени до первого зелёного `ci-ok` на `main` (#876; с `c43e9648` это верно).
