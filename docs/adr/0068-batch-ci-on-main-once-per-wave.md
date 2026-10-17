# 0068 — Batch CI: GitHub CI идёт на `main` один раз на Wave, а не на каждый PR
Дата: 2026-10-17. Статус: принят.

**Контекст.** Workflow `CI` (`.github/workflows/ci.yml`) шёл на каждый push в pull request и на каждый
push в `main`: lint, typecheck, unit и contract test-ы на `ubuntu-latest`, около 10 минут на CI run.
2026-10-15 — 112 CI run-ов (около 1 260 минут), 2026-10-16 — 81 (около 960 минут). Ветка PR набирает
медиану 2 CI run-а и до 8, плюс ещё один на merge. В 05:38 UTC 2026-10-17 GitHub перестал запускать
job-ы: кончился бюджет Actions. При этом gate перед merge уже на Mac: `GATE_SCOPE=all` gate full
(lint, typecheck, test, e2e, собранный `.app`) — на наборе Wave (ADR-0065) или на каждом PR, а для
платформенных PR — ещё вердикт Windows-ПК (ADR-0056). CI на Linux повторяет часть gate full и
добавляет только то, что отличается на Linux. Branch protection у `main` нет: GitHub checks для merge
не требует.

**Решение** (владелец, 2026-10-17, около 09:20 UTC). Для worfy GitHub CI больше не gate перед merge PR.

1. PR вливается по gate на Mac, как говорит `workflow.merge_gate` (`wave` или `each`), плюс вердикт
   Windows-ПК для платформенного PR. ADR-0056 не меняется.
2. CI идёт на `main` один раз на Wave, после того как набор Wave влит: `wave-gate ci` запускает
   команду Profile-а `workflow.ci_batch_run` (для worfy — `gh workflow run ci.yml --ref $ref -f job=check`)
   и записывает id и URL CI run-а. Orchestrator ждёт его результат до отчёта Wave.
3. Красный batch CI run — без revert: Autopilot run останавливается после этой Wave, отчёт даёт ссылку
   на CI run и упавшие job-ы и test-ы, сбой становится Ticket-ом или строкой `blocked`. Исправление
   вперёд.
4. `ci.yml` запускается только вручную (`workflow_dispatch`) с input `job`: `check` (по умолчанию) или
   `full-macos`. Dispatch из Wave никогда не занимает macOS runner. `schedule` нет.
5. Включается полем Profile-а `workflow.ci: "batch"`. По умолчанию — `"pr"`, сегодняшнее поведение:
   владелец считает batch CI плохой практикой, которой нет ни в одном другом его репозитории, и
   другие Project его не получают.

**Последствия.**

- Сбой, который виден только на Linux (регистр букв в путях, `zsh` нет в образе, другой `node-pty`),
  попадает в `main` и находится раз на Wave, а не до merge PR. Виноватый PR ищется по списку набора.
- Между Wave `main` может быть красным на Linux. Красный batch CI run останавливает Autopilot run, и
  следующая Wave не идёт на красный `main`.
- Stable copy собирается из `main` на Mac, и gate full на Mac перед merge остаётся — сломанная на Mac
  сборка в `main` по-прежнему не попадает.
- Около одного CI run-а на Wave вместо 2–8 на PR плюс один на merge.
- Тексты Harness с `workflow.ci: "batch"` не ждут CI на PR; PR вливается, когда `mergeable` —
  `MERGEABLE`, даже если старые checks красные или checks нет.
- Переход нельзя растянуть во времени. Правка `ci.yml` действует на все PR сразу, в момент merge, а
  поле Profile-а — только когда его прочтёт обновлённый Harness. Пока Profile говорит `pr`, Harness
  ждёт CI run на PR, который больше не придёт. Порядок: merge PR этого решения, пока не идёт ни один
  Autopilot run; сразу обновить живой Harness; добавить в Profile `"ci": "batch"` и
  `ci_batch_run`; первый batch CI run на `main` запустить вручную.
- Batch CI run-ы одного job на `main` идут по одному и не отменяют идущий (`cancel-in-progress:
  false`): иначе CI run одной Wave, отменённый dispatch-ем следующей, читался бы как красный.
  Ожидающий run GitHub всё же отменяет при новом dispatch; такой `cancelled` при более новом run
  считается вытесненным, а не красным.

## Considered Options

- **CI на каждый PR и на push в `main` (как было, `workflow.ci: "pr"`).** Linux-сбой виден до merge.
  Цена — 2–8 CI run-ов на PR и один на merge; бюджет кончился 2026-10-17. Остаётся по умолчанию для
  других Project.
- **CI на PR с `cancel-in-progress`.** Новый push отменяет старый CI run, но каждый PR всё равно
  получает хотя бы один CI run, плюс merge. Экономит повторы, а не PR — отвергнуто.
- **Integration branch `next`: PR вливаются в `next`, `next` вливается в `main` после одного CI run.**
  `main` остаётся зелёным на Linux. Отвергнуто: приложение и Harness читают статусы Ticket-ов из main
  checkout, и отстающий checkout уже дал ложную остановку `wave-unfinished` 2026-10-17. Вторая ветка
  делает отставание правилом.
- **Один CI run на Wave на `main` (выбрано).** Один CI run на Wave, gate на Mac остаётся gate. Цена —
  Linux-сбой находится после merge, исправление вперёд.
