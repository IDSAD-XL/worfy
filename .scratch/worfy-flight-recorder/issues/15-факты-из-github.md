# 15 — Факты из GitHub

Type: task
Status: claimed 2026-11-01T01:48Z
Blocked by: 10, 12
Source: [spec.md](../spec.md), «Модель» (Wait `other-machine`, повтор CI run, «Неполная история» — «GitHub did not answer»), «Источники и что меняется в них» (строка GitHub, ключ связи по ветке и sha), «Живая шкала» (GitHub — не чаще раза в минуту), «Windows» (gh), «Ticket-ы» (15); решение 03, Q5 ([03-модель-spans.md](03-модель-spans.md)); решение 04, Q3 ([04-дыры-источников.md](04-дыры-источников.md)); решение 07 ([07-живая-шкала-или-после-остановки.md](07-живая-шкала-или-после-остановки.md)); решение 08, Q7 ([08-неполная-история.md](08-неполная-история.md))

## Что происходит

- После Ticket-а 10 разбор PR — `src/shared/flight-recorder/pr-facts.mjs` (поля `gh`, как у
  `scripts/critical-path.mjs`, плюс `labels`).
- `gh` в приложении — `gh()` из `src/main/github/prs.ts` с аккаунтом Profile-а; правило `WORFY_GH` для Windows
  (`windowsOverride`, `:81`) уже там. `PrTracker` (`:395`) читает PR раз в минуту.
- PR и commit-ы с Run связываются по ветке Ticket-а (`worfy-flight-recorder/<NN>` — форма `tickets.branch`
  Profile-а) и sha; в commit-ы и PR ничего не штампуется.
- GitHub не угасает, но может не ответить (нет сети, нет входа в `gh`).

## Что делаем

1. `src/shared/flight-recorder/from-github.ts` — чистый разбор ответов `pr-facts.mjs` в факты модели Ticket-а 12:
   PR открыт; CI runs и их повторы (`#N` со ссылкой на прошлый run); verdict-комментарии; отметки агентов на head;
   merge; **Wait `other-machine`** — от метки cross-machine gate на PR до времени отчёта.
   Время — только время GitHub.
2. `src/main/flight-recorder/github.ts` — чтение через `gh()` аккаунтом Profile-а, не чаще раза в минуту, как
   `PrTracker`; ответ держится в памяти, на диск ничего не пишется.
3. GitHub не ответил — шкала строится из локальных источников, полосы PR и CI помечены «GitHub did not answer»;
   повторное чтение по запросу («Retry» — канал в Ticket-е 17, кнопка — в 19).

`pr-facts.mjs` этот Ticket только импортирует (общий файл с Ticket-ом 11 той же Wave).

## Готово, когда

- [ ] Unit test разбора: PR с двумя CI runs на одном head — второй `#2` со ссылкой на первый; verdict
      REJECTED и VERIFIED; merge; отметки агентов на head.
- [ ] Unit test Wait `other-machine`: метка cross-machine gate на PR и время отчёта дают Wait с этими границами;
      без отчёта — span без конца (правило обрыва модели).
- [ ] Contract test (`gh` — stand-in `.mjs` через `WORFY_GH`): ответы ночного Run дают PR и CI runs Ticket-ов по
      ветке; второе чтение в пределах минуты не зовёт `gh`.
- [ ] Contract test: stand-in выходит с ошибкой — факты помечены «GitHub did not answer», локальная часть
      шкалы есть; ответ-ошибка держится минуту, как удачный (решение 07), «Retry» (`retry: true`) читает сразу,
      через минуту чтение снова зовёт `gh` (решено оркестратором 2026-11-01).
- [ ] Contract test: `gh` зовётся аккаунтом Profile-а Project-а (как `gh()` в `prs.ts`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный.

## Тесты

- Unit `test/unit/flight-recorder-github.test.ts` (новый): разбор ответов.
- Contract `test/contract/flight-recorder-github.test.ts` (новый): stand-in `gh` через `WORFY_GH`, ответы gh ночного
  Run (обезличенные, соглашения spec-а).
- Сначала падающий: два CI runs на одном head — второй не помечен `#2`.
- Прогнать `test/unit/flight-recorder-*.test.ts`, `test/unit/critical-path.test.ts`,
  `test/contract/github-prs.test.ts`, `test/contract/github-accounts.test.ts`.

## Где в коде

- `src/shared/flight-recorder/from-github.ts` (новый)
- `src/main/flight-recorder/github.ts` (новый)
- `test/unit/flight-recorder-github.test.ts` (новый)
- `test/contract/flight-recorder-github.test.ts` (новый)

Только читать: `src/shared/flight-recorder/pr-facts.mjs`, `src/main/github/prs.ts` (`gh()`, `PrTracker`),
`src/shared/flight-recorder/spans.ts`.

## Итог

- `src/shared/flight-recorder/from-github.ts` — чистый разбор (без Node и DOM; импортирует только `./facts`,
  `./journal-walk.mjs`, `./pr-facts.mjs`). `githubFacts(answer, { tickets, window, account, crossMachineGate })`
  (`:314`) отдаёт часть `RunFacts` GitHub-а: `ticketEvents`, `work` вида `ci`, `waits` `other-machine`;
  `githubNoAnswer()` (`:87`) — только `lost` «GitHub did not answer» (`GITHUB_NO_ANSWER`, `:84`).
- PR связывается с Ticket-ом по ветке (`tickets` — пары Ticket и ветка, форму `tickets.branch` подставляет сервис 17).
  **Что выбрано по окну Run:** PR, влитый или закрытый (`mergedAt`, иначе `closedAt`) до начала Run, и PR, открытый
  после его конца, отбрасываются (`prsOfRun`, `:95`); у оставленного PR отдаются все события, и до Run тоже: модель
  прижимает их к строке Ticket-а (событие до первого статуса — неявный claim, `spans.ts:335`), а события после конца
  Run модель сама не читает. Живой Run (`window.end: null`) берёт и только что открытый PR. Один PR дважды в ответе —
  один PR.
- За Gate говорит только `github.account` Project-а (репозиторий публичный): verdict-комментарий и отчёт
  cross-machine gate другого автора не считаются, без аккаунта (`account: null`) не считается ни один (как правило 1
  gate queue). `verdictComments` в `pr-facts.mjs` (`byGate`, `:109`) получил второй аргумент: login — только его
  комментарии, `null` — никакие; без аргумента (`scripts/critical-path.mjs`) не считается комментарий, который gh
  помечает `authorAssociation` не OWNER/MEMBER/COLLABORATOR, а комментарий без этого поля считается. Отчёт
  critical-path на ночной fixture-е побайтно тот же (`cmp` текстового и `--csv` до и после, exit 0).
- События: `pr-opened` на head, который был у PR в момент открытия; каждый commit с `committedDate` после открытия —
  `push`; CI ветки — `ci-started`/`ci-finished` на своём head; отметки агентов — commit statuses `review`,
  `check/<name>`, `deploy` на head (`markEvents`, `:150`); `approved` — время последнего APPROVED review при
  `reviewDecision` APPROVED; `merge` с номером PR и merge commit. gh даёт statuses только head-а, поэтому
  verdict-комментарии (`VERIFIED`, `REJECTED`, и после `NARROW:`), написанные до commit-а head-а, — тоже отметки
  `review` (REJECTED прошлого head-а даёт модели круг доработки); после него при status `review` на head
  комментарии не берутся (`:164`): status их покрывает.
- CI: span на каждый workflow run ветки (`gh run list --branch`), ручные runs ветки (`workflow_dispatch`) — не CI PR,
  как в `ciMark` (`:201`); у ветки без runs — на каждый check run head-а. Run на том же head, что более ранний run
  того же имени, — его повтор: `retryOf` на прошлый, модель рисует `#2`, `#3` (`runFacts`, `:239`). Re-run, который
  GitHub хранит одним run с `attempt` N, связать не с чем — пометка `attempt N on GitHub`. Runs merge commit-а (batch
  CI на main, `gh run list --commit <mergeCommit>`; в batch-период их запускали вручную, поэтому здесь
  `workflow_dispatch` остаётся) — CI Ticket-а под именем `<workflow> on <base>` (`CI on main`, чтобы модель не
  считала его повтором CI PR), Stage не двигают. Ночной Run: runs #460 и #467 привязаны к 07 и 04; run `9cbe6794`
  (docs commit поверх merge #457) по точному sha не привязывается — предка без git не узнать.
- Wait `other-machine` (`waitsOf`, `:287`): PR ждёт, если на нём метка `cross_machine_gate.label` или есть отчёт
  `<checks_section> report: green|red` аккаунта Project-а (метку снимают при merge, поэтому отчёт тоже доказывает
  ожидание). Начало — открытие PR или commit после отчёта, по `committedDate`, как правило 1 gate queue (rebase
  автора после красного отчёта снова ставит PR в ожидание; rebase serve-машины идёт до её отчёта); конец — отчёт;
  без отчёта: merge/закрытие, а у открытого PR — `end: null` (обрыв модели). Ночной #468: с 02:00:50 до отчёта
  15:58:37.
- `src/main/flight-recorder/github.ts` — `GithubReader`: `gh` через `PrTracker.gh` (аккаунт Profile-а, `WORFY_GH`,
  правила Windows `ghRunner`); на ветку — `pr list --state all --head <ветка>`, для ветки с PR — runs ветки, для
  влитого PR — runs merge commit-а (только oid вида sha); ветка, которую gh прочёл бы как опцию (`-x`), не
  спрашивается; вызовы по одному. Не чаще раза в минуту на Project и набор веток, ответ — только в памяти; два
  чтения сразу делят один запуск gh. Ошибка gh или ответ не JSON/не список — `{ answer: null, error }`; этот ответ
  тоже держится минуту, `read(..., { retry: true })` читает сразу — это «Retry» для 17 (решено оркестратором
  2026-11-01).
- Тесты: `test/unit/flight-recorder-github.test.ts` (29), `test/contract/flight-recorder-github.test.ts` (10) со
  stand-in `test/fixtures/flight-recorder/gh-night-run.mjs` через `WORFY_GH` (новый файл fixture-ы: общий
  `test/fixtures/gh/gh-stub.mjs` не знает `pr list --head` с этими полями и `run list`). Mutation pass: 33 мутанта
  `from-github.ts`, `github.ts` и `pr-facts.mjs`, все убиты.

Не проверено:

- Полосы PR своей нет у модели (вида span `pr` нет), поэтому «GitHub did not answer» ставится на CI каждого Ticket-а
  без CI span; Stage-ы при этом строятся только из Journal.
- Настоящий gh не запускался (только stand-in): поля `reviews`, `closedAt`, `startedAt` run-а и флаг
  `run list --commit` проверены по `gh --help` 2.97, не ответом GitHub.
- Время push по GitHub не отдаёт; `push` и начало Wait после отчёта стоят на `committedDate` commit-а — после rebase
  все commit-ы получают время rebase, так что второй Wait после позднего rebase начинается с него.
- `retry` во время уже идущего чтения не запускает второе: возвращает идущее (его ответ свежий).
