# 01: Запуск eval-ов на API key организации Console и проверка расхода одним коротким run-ом

Type: task
Status: claimed 2026-11-28T04:38Z
Branch: worfy-harness-eval/01
Blocked by: None — can start immediately
Source: [spec.md](../spec.md), «Ticket-ы», 01; «Решения владельца», «Деньги» (Ticket 02 темы, «все да»); «Решено
советником» («Счёт за запуск выбирается явно»); «Решения по реализации» («Счёт за запуск»); «Решения по test-ам»
(«Счёт за запуск — test»); «Риски» (`claude plugin eval` с API key может списывать лимит подписки); «Заметки»;
«Волны», Wave 1

Кто: агент. Глубина ревью — `high`: ключ, который тратит деньги, не должен попасть ни в репозиторий, ни в лог, ни в
отчёт.

Перед стартом: владелец привязал организацию Console к подписке (claude.ai → Settings → Billing), создал API key и
выключил auto-reload, ключ лежит в папке состояния Harness. Orchestrator спрашивает владельца об этом до claim; если
нет — `ticket block worfy-harness-eval 01 "<что не сделано>" --waits owner`.

## Что происходит

- Оба платных скрипта, `pnpm eval:harness` (`scripts/eval-harness.mjs`) и `pnpm eval:outcome`
  (`scripts/eval-outcome.mjs`), запускают `claude` под входом подписки владельца. Окружение готовит
  `cleanEnv` в `scripts/eval-run-env.mjs:73`; выбора «на кредитах» нет.
- 200 USD API-кредитов в месяц из подписки владельца сгорают неистраченными, а eval-ы тратят лимит подписки.
- Справка Anthropic прямо называет списание с API key только для `claude -p` и Agent SDK. Куда спишет
  `claude plugin eval` с ключом, неизвестно — это первый вопрос Ticket-а.

## Что строить

- Счёт за запуск — явный выбор. По умолчанию подписка, как сейчас: так остаётся `--changed` по PR. Запуск на кредитах
  — опция скриптов, например `--billing credits`; имя выбирает Ticket.
- Ключ лежит в папке состояния Harness на машине (`HARNESS_HOME`, по умолчанию `~/.claude/worfy-harness/`), имя файла
  выбирает Ticket. В репозиторий ключ не попадает.
- Ключ попадает только в окружение дочернего `claude` (`ANTHROPIC_API_KEY`), и только при запуске на кредитах. В
  stdout, stderr, `aggregate-result.json`, отчёт и transcript-ы скрипт его не пишет. Если ключа нет, запуск на
  кредитах — отказ до вызова модели.
- `--dry-run` печатает, какой счёт выбран; ключ в нём маскирован.
- Первый платный запуск — один короткий case (`status-block`, около 0,12 USD) на кредитах. Потолок запуска —
  `--max-cost-usd 2`. Сначала `--dry-run` с теми же аргументами.
- Orchestrator пишет в «Итог»: дату и время run-а, `costUsd` из отчёта, что показал Console (это ручной пункт
  владельца ниже) и куда ушёл расход — в кредиты или в лимит подписки.
- Если `claude plugin eval` с ключом списывает лимит подписки: «Итог» это называет. Тогда регулярные замеры идут
  через `claude -p` (runner Ticket-а 08) или ждут решения владельца; Orchestrator задаёт вопрос, а 05, 07 и 14–17 ждут
  (`--waits owner`).
- Модель и judge не меняются: это Ticket 02.

## Где в коде

- `scripts/eval-run-env.mjs` — `cleanEnv` `:73`, `runClaude`; новое — чтение ключа и окружение запуска на кредитах
- `scripts/eval-harness.mjs` — разбор опций `:300-316`, строка бюджета `:372`
- `scripts/eval-outcome.mjs` — разбор опций `:280-295`
- `harness/hooks/eval-env.cjs` — только читать: папка состояния Harness
- `test/contract/harness-evals-run.test.ts`, `test/contract/harness-evals-outcome.test.ts` — новые test-ы счёта

## Test-ы

- Contract test-ы со stub-ом `claude` (тот же seam, что сейчас):
  - запуск на кредитах передаёт ключ в окружение дочернего процесса, запуск по умолчанию — нет;
  - подложенный ключ не появляется ни в stdout, ни в stderr, ни в записанных файлах;
  - нет файла ключа — отказ до вызова `claude`;
  - `--dry-run` называет счёт и не печатает ключ.
- Сначала падающий test: stub `claude` печатает своё окружение; без правки ключ в нём есть всегда или нет никогда.
- Без моделей в CI; настоящий binary Codex не запускается.

## Готово, когда

- [ ] Опция счёта в `pnpm eval:harness` и `pnpm eval:outcome`; по умолчанию — подписка.
  - evidence: test-run pass · `pnpm test test/contract/harness-evals-run.test.ts test/contract/harness-evals-outcome.test.ts` exit 0 · mac - · 75b01732e6887fad8efc6c9fa1ab04fa40a7259c
- [ ] Ключ — только в папке состояния Harness и в окружении дочернего `claude` при запуске на кредитах; contract test-ы
      это проверяют.
  - evidence: test-run pass · `pnpm test test/contract/harness-evals-run.test.ts test/contract/harness-evals-outcome.test.ts` exit 0 · mac - · 75b01732e6887fad8efc6c9fa1ab04fa40a7259c
- [ ] `--dry-run` с теми же аргументами прошёл до платного запуска; один run `status-block` на кредитах с потолком
      `--max-cost-usd 2`; строка `eval:harness …` в описании PR.
  - evidence: test-run pass · `pnpm eval:harness -- --case status-block --billing credits --max-cost-usd 2` exit 0 after the same with --dry-run exit 0; costUsd 0.31 · mac - · 75b01732e6887fad8efc6c9fa1ab04fa40a7259c
- [x] (вручную) Сделай: открой Console → Usage после run-а из «Итога» → Должно быть: расход этого run-а за дату run-а
      в организации, привязанной к подписке; баланс кредитов уменьшился, auto-reload выключен.
  - needs: mac
  - evidence: owner-check pass · 2026-11-28: все верно (Console → Usage 2026-11-28 ~05:03 UTC shows the ~0.31 USD run on the API key credits) · mac stable · 5bf665f77
- [ ] «Итог» называет, куда ушёл расход `claude plugin eval` с ключом: в кредиты или в лимит подписки.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 75b01732e6887fad8efc6c9fa1ab04fa40a7259c

## Итог

- Опция — `--billing subscription|credits` (и `--billing=<имя>`) в `pnpm eval:harness` и `pnpm eval:outcome`; по
  умолчанию `subscription`. Опция не доходит до `claude`. Неизвестное имя, опция без значения или дважды — отказ до
  `claude` (`eval:harness` — exit 1, `eval:outcome` — exit 2, как его прочие ошибки разбора). Общий код —
  `takeBilling`, `billingFor`, `apiKeyFile` в `scripts/eval-run-env.mjs`.
- Файл ключа — `~/.claude/worfy-harness/secrets/anthropic-api-key`, в общем виде `<HARNESS_HOME>/secrets/anthropic-api-key`
  (`HARNESS_HOME` или `~/.claude/worfy-harness`, как `harness/hooks/eval-env.cjs` вне run-а). Ключ читается с обрезкой
  пробелов и попадает только в окружение вызовов `claude plugin eval`: не в `claude --version`, не в git и не в копию
  git. Нет файла или он пустой — отказ до любого `claude`, даже до `--version`, и в `--dry-run` тоже.
- Каждый запуск печатает строку `billing …`; для кредитов — `billing credits: ANTHROPIC_API_KEY=<hidden> from <файл>`,
  в `--dry-run` тоже. Сам ключ не печатается нигде.
- Изменение поведения: `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN` оболочки теперь не доходят ни до одного run-а, в
  том числе по умолчанию. Иначе ключ, экспортированный в shell, молча делал бы run «на подписке» платным по ключу.
- Не сделано: judge-вызовы score в `pnpm eval:outcome` (`judgeCommand` в `scripts/eval-outcome-lib.mjs`, вне «Где в
  коде») `--billing` не получают. На кредитах они по-прежнему идут под вход подписки. Это сказано в шапке
  `scripts/eval-outcome.mjs`.
- Сначала падающий test: 10 новых contract test-ов (`-t billing` в `harness-evals-run.test.ts` и
  `harness-evals-outcome.test.ts`) красные на коде до правки, exit 1. Stub `claude` (`test/fixtures/eval-stub/claude.cjs`
  и stub в `harness-evals-outcome.test.ts`) теперь пишет в свой лог `ANTHROPIC_API_KEY` и `ANTHROPIC_AUTH_TOKEN`
  вызова. Ключ в test-ах — поддельный, в временном `HARNESS_HOME`.
- Платный run (владелец заранее одобрил платные eval-ы до 100 USD, бриф — ровно один run):
  - `pnpm eval:harness -- --case status-block --billing credits --max-cost-usd 2 --dry-run` — exit 0, один вызов
    `main-status-block`, потолок 2 USD, ключ скрыт.
  - `pnpm eval:harness -- --case status-block --billing credits --max-cost-usd 2` — 2026-11-28, 05:02:46–05:03:29 UTC,
    exit 0. Строка для PR: `eval:harness main: casesPassed 1 of 1, overallScore 1, costUsd 0.31, claudeVersion 2.1.322,
    cases status-block`.
  - `costUsd` 0,31, а не 0,12: `claude plugin eval` по умолчанию делает 3 run-а case-а (0,13 + 0,09 + 0,09 USD).
    Потолок 2 USD не задет.
  - Ключ claude принял: run прошёл без ошибки входа. Поиск префикса ключей Anthropic в выводе run-а и в
    `harness/evals/results/` — 0 совпадений.
- Куда ушёл расход — **из run-а не видно**. Ни вывод `claude plugin eval`, ни `aggregate-result.json`, ни
  `report.html` не называют способ оплаты: там только `costUsd`. Признака списания с лимита подписки run тоже не
  дал. Ответ даст только ручной пункт Console выше (Usage за 2026-11-28 около 05:03 UTC, расход ≈ 0,31 USD). Пока его
  нет, вопрос «кредиты или лимит подписки» открыт, и Orchestrator решает, ждут ли 05, 07 и 14–17.
- 2026-11-28, слово владельца: Console → Usage показывает run около 05:03 UTC (≈ 0,31 USD) — расход `claude plugin eval`
  с ключом ушёл **в кредиты организации Console**, не в лимит подписки. Тикеты 05, 07 и 14–17 этого не ждут.
