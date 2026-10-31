# 15 — Факты из GitHub

Type: task
Status: open
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
