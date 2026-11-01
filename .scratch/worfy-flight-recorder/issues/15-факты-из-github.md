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
      шкалы есть; следующее чтение после ошибки снова зовёт `gh`.
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
  `./journal-walk.mjs`, `./pr-facts.mjs`). `githubFacts(answer, { tickets, window, crossMachineGate })` (`:295`)
  отдаёт часть `RunFacts` GitHub-а: `ticketEvents`, `work` вида `ci`, `waits` `other-machine`; `githubNoAnswer()`
  (`:82`) — только `lost` «GitHub did not answer» (`GITHUB_NO_ANSWER`, `:79`).
- PR связывается с Ticket-ом по ветке (`tickets` — пары Ticket и ветка, форму `tickets.branch` подставляет сервис 17).
  **Что выбрано по окну Run:** PR, влитый до начала Run, и PR, открытый после его конца, отбрасываются (`prsOfRun`,
  `:90`); у оставленного PR отдаются все события, и до Run тоже: модель прижимает их к строке Ticket-а (событие до
  первого статуса — неявный claim, `spans.ts:335`), а события после конца Run модель сама не читает. Живой Run
  (`window.end: null`) берёт и только что открытый PR.
- События: `pr-opened` на head, который был у PR в момент открытия; каждый commit с `committedDate` после открытия —
  `push`; CI ветки — `ci-started`/`ci-finished` на своём head; отметки агентов — commit statuses `review`,
  `check/<name>`, `deploy` на head (`markEvents`, `:135`); `approved` — время последнего APPROVED review при
  `reviewDecision` APPROVED; `merge` с номером PR и merge commit. Verdict-комментарии (`VERIFIED`, `REJECTED`, и
  после `NARROW:`) становятся отметками `review` только у PR без status `review` на head (до ADR-0067), иначе
  verdict — status, а комментарии отметками не считаются (`:149`): так нет двойных отметок.
- CI: span на каждый workflow run ветки (`gh run list --branch`); у ветки без runs — на каждый check run head-а.
  Run на том же head, что более ранний run того же имени, — его повтор: `retryOf` на прошлый, модель рисует `#2`
  (`runFacts`, `:223`). Re-run, который GitHub хранит одним run с `attempt` N, связать не с чем — пометка
  `attempt N on GitHub`. Runs merge commit-а (batch CI на main, `gh run list --commit <mergeCommit>`) — CI Ticket-а
  с пометкой `CI on <base> after the merge`, Stage не двигают. Ночной Run: runs #460 и #467 привязаны к 07 и 04;
  run `9cbe6794` (docs commit поверх merge #457) по точному sha не привязывается — предка без git не узнать.
- Wait `other-machine` (`waitsOf`, `:268`): PR ждёт, если на нём метка `cross_machine_gate.label` или есть отчёт
  `<checks_section> report: green|red` аккаунта Project-а (метку снимают при merge, поэтому отчёт тоже доказывает
  ожидание). Начало — открытие PR или commit после отчёта, по `authoredDate` (rebase на serve-машине переписывает
  `committedDate` всех commit-ов); конец — отчёт; без отчёта: merge/закрытие, а у открытого PR — `end: null`
  (обрыв модели). Ночной #468: с 02:00:50 до отчёта 15:58:37.
- `src/main/flight-recorder/github.ts` — `GithubReader` (`:68`): `gh` через `PrTracker.gh` (аккаунт Profile-а,
  `WORFY_GH`, правила Windows `ghRunner`); на ветку — `pr list --state all --head <ветка>`, для ветки с PR — runs
  ветки, для влитого PR — runs merge commit-а; вызовы по одному. Не чаще раза в минуту на Project и набор веток
  (`:93`), ответ — только в памяти. Ошибка gh или ответ не JSON/не список — `{ answer: null, error }`; этот ответ
  тоже держится минуту (упавший gh не дёргается чаще), `read(..., { retry: true })` читает сразу — это «Retry» для 17.
- Тесты: `test/unit/flight-recorder-github.test.ts` (19), `test/contract/flight-recorder-github.test.ts` (8) со
  stand-in `test/fixtures/flight-recorder/gh-night-run.mjs` через `WORFY_GH` (новый файл fixture-ы: общий
  `test/fixtures/gh/gh-stub.mjs` не знает `pr list --head` с этими полями и `run list`). Mutation pass: 23 мутанта
  `from-github.ts` и `github.ts`, все убиты.

Не проверено:

- Полосы PR своей нет у модели (вида span `pr` нет), поэтому «GitHub did not answer» ставится на CI каждого Ticket-а
  без CI span; Stage-ы при этом строятся только из Journal.
- Настоящий gh не запускался (только stand-in): поля `reviews`, `closedAt`, `startedAt` run-а и флаг
  `run list --commit` проверены по `gh --help` 2.97, не ответом GitHub.
- Время push по GitHub не отдаёт; `push` стоит на `committedDate` commit-а — после rebase все commit-ы получают
  время rebase.
