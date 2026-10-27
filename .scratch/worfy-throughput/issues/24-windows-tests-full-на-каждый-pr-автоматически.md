# 24 — «Windows tests» на каждый PR автоматически: режим `full` по `pull_request`, вердикт `check/windows` для scope `runner` — из этого run-а

Type: task
Status: open
Blocked by: 35
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: процесс», решение 5 («Full на каждый PR
автоматически»); репозиторий `IDSAD-XL/worfy` публичный с 2026-10-27 — GitHub-hosted runner-ы для него бесплатны;
[ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 1 (Windows-runner-а на PR нет);
[ADR-0071](../../../docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md), пункты 1–3 и отвергнутый
вариант «полный run по триггеру `pull_request`». Ticket заменяет черновик «прицельный набор Windows-runner-а
по diff PR»: выбор файлов по diff был нужен только ради цены. Правка 2026-10-28 (решение 0, CI на runner-ах):
сам run `full` на каждый PR входит в Ticket [35](35-ci-на-github-runner-ах-на-каждый-pr-и-push-в-main.md);
здесь остаются вердикт `check/windows` из этого run-а, ADR и правила.

## Что происходит

- `.github/workflows/windows-tests.yml` запускается только вручную (`workflow_dispatch`): режим `files` (1–12
  файлов) или `full` (весь `pnpm test`, без e2e, около 40 min, предел 60 min). Комментарий в начале файла
  объясняет это ценой минуты Windows ($0.010).
- `test/contract/windows-tests-workflow.test.ts:91-96` закрепляет «единственный триггер — `workflow_dispatch`»
  и запрещает слова `push`, `pull_request`, `pull_request_target` в файле.
- Вердикт Windows платформенного PR со scope `runner` (`scripts/windows-verdict-scope.mjs` печатает `runner`)
  — зелёный run `full` на head, который Orchestrator запускает руками (ADR-0071, пункт 2), и метка
  `check/windows` `success` (ADR-0067). Каждый такой PR ждёт dispatch Orchestrator-а и ещё
  около 40 min run-а: Windows-Ticket от конца работы до merge — 2,5 h против 0,6 h у прочих (аналитика
  2026-10-27).
- С 2026-10-27 репозиторий публичный: довод цены из ADR-0056, пункт 1, и ADR-0071 («платные минуты без решения
  Orchestrator-а») больше не действует.

## Что делаем

Пункты 1 и 2 делает Ticket 35 (Windows job `full` в составе `ci-ok`). При claim сверить с его PR: что там уже
есть, вычеркнуть здесь; чего нет (отмена прежнего run-а, `paths-ignore` для документов, комментарий файла) —
доделать здесь.

1. `windows-tests.yml`: второй триггер `pull_request` (`opened`, `synchronize`, `reopened`). На нём идёт только
   job режима `full` (`pnpm test`); job `files` — только по `workflow_dispatch`, как сейчас. `workflow_dispatch`
   остаётся: режим `files` для повторов и run `full` на `main` после Wave (ADR-0071, пункт 2, и Ticket 27).
   - **Никогда `pull_request_target`:** он идёт с токеном на запись и с secrets на коде из чужого fork-а.
   - `permissions: contents: read`; secrets job не читает.
   - `concurrency` по номеру PR с `cancel-in-progress: true`: новый push в PR отменяет run прежнего head.
   - PR, который меняет только документы (`.scratch/**`, `docs/**`, `**/*.md`), run не запускает
     (`paths-ignore`): у него нет вердикта Windows, и run занимал бы runner около 40 min впустую.
   - Комментарий в начале файла переписать: когда run идёт сам, кто запускает dispatch, почему не
     `pull_request_target`.
2. `test/contract/windows-tests-workflow.test.ts`: триггеры — ровно `pull_request` и `workflow_dispatch`; слов
   `pull_request_target`, `push`, `schedule`, `workflow_run` в файле нет; на `pull_request` идёт только job
   `full`; `permissions` только на чтение; `concurrency` с отменой прежнего run-а на месте.
3. `scripts/windows-run-verdict.mjs <head-sha>`: находит run «Windows tests» с событием `pull_request` на этом
   SHA (`gh run list --workflow windows-tests.yml --commit <sha> --json …`) и печатает одно слово: `success`,
   `pending` (run идёт или в очереди), `failure` (красный или отменён не новым push-ем) или `none` (run-а нет).
   Код 0 на любое из четырёх; ошибка `gh` или аргумента — код 2, это не вердикт. Его читают Orchestrator,
   `land` (Ticket 27) и поле `windows_verdict` `wave-gate` (Ticket 29).
4. Новый ADR (номер — `bin/preflight` на claim): run `full` на каждый PR автоматически; для scope `runner`
   метка `check/windows` ставится по выводу `windows-run-verdict.mjs` на проверенном head, dispatch на head
   больше не нужен; scope `pc` — по-прежнему gate full на ПК (ADR-0056, пункт 2; Ticket 30 меняет это
   отдельно). Принятые ADR не правятся: в конец ADR-0056 и ADR-0071 — `## Amendments` одной датированной строкой
   со ссылкой на новый ADR.

Выбор test-файлов для Windows по diff (черновик этого Ticket-а) — не делаем: денег он больше не экономит. Если
`full` на PR (около 40 min) станет самым долгим шагом до merge, режим `files` по выводу
`scripts/affected-tests.mjs` (Ticket 21) — отдельный Ticket ради скорости.

Вне репозитория:

- `rules.md` Profile-а worfy (Orchestrator после merge; слово владельца дано 2026-10-28): пункт «Check
  `windows` может ответить run» — вердикт `runner` = автоматический run на head PR по
  `windows-run-verdict.mjs`, без dispatch.
- **Шаг владельца, не код:** Settings → Actions → General → «Fork pull request workflows from outside
  collaborators» — оставить одобрение владельцем для внешних участников («Require approval for all outside
  collaborators» или строже). Тогда PR из чужого fork-а не запускает Windows-runner без «да» владельца.

Нужен ПК: **да, для merge, если PR меняет `.github/workflows/windows-tests.yml`** — этот файл в списке `PC_ONLY`
(`scripts/windows-verdict-scope.mjs:94`, «правила самого run-а»): scope `pc`, вердикт Windows — gate full на
ПК. Если пункты 1–2 целиком сделал Ticket 35, PR меняет только скрипт, test и ADR — scope `runner`. Трогает Harness: нет (строка `rules.md` после merge —
да, слово владельца дано 2026-10-28). Вердикт Windows: `pc` или `runner` — см. выше.

## Готово, когда

- [ ] Автоматический run `full` на head PR есть (Ticket 35 или этот); второй push в PR отменил run прежнего
      head — ссылка в «Итог».
- [ ] `test/contract/windows-tests-workflow.test.ts` проверяет пункт 2 и краснеет, если в файл вернуть
      `pull_request_target` или убрать `concurrency` (проверено руками, вывод — в «Итог»).
- [ ] `test/unit/windows-run-verdict.test.ts` со stub-ом `gh`: зелёный run — `success`; run в очереди —
      `pending`; красный — `failure`; run-а нет — `none`; ошибка `gh` — код 2.
- [ ] ADR и `## Amendments` в ADR-0056 и ADR-0071.
- [ ] (вручную, после merge) Первый docs-PR не запустил run; первый PR с кодом — запустил; ссылки в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge — `ci-ok` (Ticket 35; до него — gate full Orchestrator-а); вердикт
      Windows — по `scripts/windows-verdict-scope.mjs` на head (`pc`, если меняется файл workflow).

## Где в коде

- `.github/workflows/windows-tests.yml`, `test/contract/windows-tests-workflow.test.ts`
- `scripts/windows-run-verdict.mjs`, `test/unit/windows-run-verdict.test.ts` — новые
- `docs/adr/<новый>`, `docs/adr/0056-windows-checks-and-two-sessions.md`,
  `docs/adr/0071-windows-runner-counts-as-the-windows-verdict.md` — только `## Amendments`
- Только читать: `scripts/windows-verdict-scope.mjs`, `scripts/windows-test-list.mjs`

## Вне скоупа

- PR со scope `pc` и gate full на ПК раз в Wave — Ticket 30.
- Платформенный PR в наборе `wave-gate` — Ticket 29.
- CI на Linux на каждый PR — Ticket 12.
- e2e на Windows-runner-е — нет: `full` гоняет только unit- и contract-test-ы.

## Итог
