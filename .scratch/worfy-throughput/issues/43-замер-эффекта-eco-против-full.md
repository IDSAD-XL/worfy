# 43 — Замер эффекта: eval исхода `eco` против `full` и повторный замер расхода

Type: task
Status: open
Blocked by: 19, 36, 37, 39
Source: [spec.md](../spec.md), раздел «Решения владельца 2026-10-28: меньше token-ов на Ticket, чтобы хватало Limits подписки», идеи 4 и 10, строки
L2–L4 таблицы «Цель и числа»; решение 14 раздела «процесс» (платный eval — только с «да» владельца);
[`worfy-harness` 52](../../worfy-harness/issues/52-сравнительный-eval-исходов-worfy-против-claude-code-без-plugin.md)
(задачи eval исхода).
Блокер из другого Epic-а: `worfy-harness` 52 — задачи eval исхода (там `Waits: owner`); `Blocked by` читает только
номера этого Epic-а.
Решение владельца 2026-10-30: платные run-ы этого Ticket-а одобрены заранее, цену отдельно не согласовывать (пробный
run без затрат перед платным остаётся). Ticket стартует сразу, как медиана CI PR станет не больше 15 min; если Ticket-ы
58 и 59 её не опустят — стартует всё равно, после них, с той скоростью CI, что есть.

## Что происходит

- Eval исхода есть: `pnpm eval:outcome -- --max-cost-usd <usd>` гонит каждую задачу с plugin-ом и без
  (`--ablation with-without`) и оценивает, что осталось после run-а (`scripts/eval-outcome.mjs:1-7`). Сравнить два
  Profile одного plugin-а он не умеет: `--ablation` закреплён (`:18`).
- Задач в `harness/evals-outcome/` пока нет (только `README.md` и `lib/`): их ждёт `worfy-harness` 52
  (`Waits: owner`).
- Повторный замер token-ов и долларов по ролям даёт `scripts/agent-cost.mjs` (Ticket 19); доли Limits на Wave —
  журнал Ticket-а 40.
- Ожидание (идея 4) закрывают Ticket-ы 25, 27, 28; сколько ходов Orchestrator-а уходит на ожидание — не мерили.

## Что делаем

1. Режим сравнения двух Profile в `eval:outcome`: те же задачи, тот же plugin, два run-а с разным Profile (`full`
   и `eco` + модели по ролям из Ticket-а 37). Итог — оценка исхода, token-ы и число кругов доработки на каждый
   run. Без вызова модели test-ы режима идут на подставном `claude`.
2. Перед платным run-ом — цена из команды, которую eval реально запустит (`--max-cost-usd`), и «да» владельца на
   этот запуск.
3. Повторный замер: `scripts/agent-cost.mjs --by-ticket` (разбивка по Ticket-у — шаг 1 Ticket-а 39; сам Ticket 19
   считает по ролям за период) за две недели до и две недели после включения `eco` — token-ы на Ticket, доля
   ролей; доля Limits на Ticket — по журналу Ticket-а 40, если он влит.
4. Замер ожидания: доля вызовов модели Orchestrator-а, которые идут сразу после результата фоновой команды или
   ожидания CI, и их token-ы — пункт отчёта `agent-cost.mjs` (`--waits`). Большая доля — предложение Ticket-а в
   «Итог».

Нужен ПК: нет. Трогает Harness: нет (скрипты eval в `scripts/`). Вердикт Windows: не платформенный PR.

## Готово, когда

- [x] Сначала падающий test режима сравнения на подставном `claude` (`test/contract/harness-evals-outcome.test.ts`): два run-а получают разные Profile, итог
      содержит обе оценки и token-ы; `--max-cost-usd` по-прежнему обязателен.
- [x] Test `--waits` в `test/unit/agent-cost.test.ts` на фикстуре: вызов после результата фоновой команды
      считается ожиданием, обычный — нет.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge — `ci-ok`.
- [ ] (вручную, с «да» владельца и ценой из команды, которую eval реально запустит) Платный run `eco` против
      `full`: оценки, token-ы, цена — в «Итог». Не закрывается, пока `worfy-harness` 52 не дал задачи.
      Пометка 2026-10-30: «да» владельца есть (решение в шапке), задач нет — run не делали, см. «Итог».
- [ ] Режим сравнения на настоящих задачах `harness/evals-outcome/` — тоже только после `worfy-harness` 52.
- [ ] «Итог»: повторный замер шага 3 и ответ — выполнена ли цель L2 spec-а для Pro (в 5–20 раз меньше).
      Пометка 2026-10-30: шаг 3 не в этом PR — `eco` в Profile worfy не включён (`workflow.agents` нет, то есть
      `full`); замер «до/после» возможен через две недели после включения.

## Где в коде

- `scripts/eval-outcome.mjs`, `scripts/eval-outcome-score.mjs`
- `scripts/agent-cost.mjs`, `test/unit/agent-cost.test.ts`
- Только читать: `harness/evals-outcome/README.md`

## Вне скоупа

- Задачи eval исхода — `worfy-harness` 52. Повторный замер критического пути — Ticket 05.

## Итог

PR #1035, ветка `worfy-throughput/43`. Implementer Ticket-а 43, 2026-10-30, Mac владельца.

### Сделано (пункты 1 и 4)

- Режим сравнения: `pnpm eval:outcome -- --compare-profiles --max-cost-usd <usd>`. Два вызова `claude plugin eval`
  на одних и тех же задачах, оба с `--ablation none` (только run с plugin-ом), каждому — половина лимита. Profile
  `full`: `workflow.agents: "full"`, поля `agents` нет. Profile `eco`: `workflow.agents: "eco"` и Sonnet + effort
  `medium` для всех ролей — preset Pro из Ticket-а 42 (`scripts/eval-outcome.mjs:74`; test сверяет его с
  `PLAN_PRESETS`). Profile задаёт временная копия plugin-а: в неё добавляется скрипт
  `evals-outcome/lib/plugin-state/zz-compare-profile.sh` (`:86`). Он идёт в scaffold-е после `worfy.sh` и меняет
  оба поля в profile fixture. `harness/` и Profile worfy не трогаются.
- Итог — `<results>/<time>/compare.json` (`:154`): по каждой задаче и Profile-ю — метрики score, token-ы, цена,
  число кругов доработки и subagent-ов на run, плюс разница `eco − full`. Круг доработки — brief subagent-а, который
  начинается с `Rework:` или несёт строку `Findings:` (`:125`); у rate — интервал Newcombe и p Фишера; у token-ов —
  отношение `full / eco`.
- `--dry-run` (`:279`) печатает каждый вызов с его `--max-cost-usd` и Profile и выходит до копий и до `claude` —
  это цена из команды, которую eval реально запустит (пункт 2). Если первый вызов упал или его остановили, второй
  не стартует (`:327`). Отказ с exit 2: `--compare-profiles --no-score`, лимит меньше 0,02, значение у своего флага,
  второй `--max-cost-usd`.
- `node scripts/agent-cost.mjs --waits` (`scripts/agent-cost.mjs:242`, `:250`, `:636`). Ожидание — это ответ
  Orchestrator-а сразу после notice о том, что закончилась фоновая команда или Monitor, или после результата
  `gh pr checks --watch` / `gh run watch`. Отчёт даёт долю таких ответов, их token-ы и цену. Ответы после notice
  «subagent закончил» идут отдельной строкой и в ожидание не входят.
- Test-ы: контрактные — на подставном `claude`, без модели (`test/contract/harness-evals-outcome.test.ts:1760`
  и дальше); unit — на синтетической фикстуре `test/fixtures/agent-cost/waits/` (`test/unit/agent-cost.test.ts:307`).
  На каждое новое поведение — mutant: 21 mutant, все дают красный test.

### Платный run (пункт 2) не делали: задач нет

«Да» владельца есть (решение 2026-10-30 в шапке), но в `harness/evals-outcome/` только `README.md` и `lib/`, в
`scripts/eval-outcome/` нет папки `hidden/`. На ветке `worfy-harness/52-infra` тоже ни одной задачи. Без задачи
`eval:outcome` выходит с кодом 1 до вызова `claude`: run сравнивать не на чем. Не хватает того, что ждёт
`worfy-harness` 52 (`Waits: owner`): четырёх задач (`prompt.md`, `case.yaml`, `scaffold.sh`, graders) и их
`score.json` со скрытыми test-ами. Как только задачи будут:
`pnpm eval:outcome -- --compare-profiles --max-cost-usd 40 --runs 1 --dry-run`, прочитать строки вызовов (по
20 USD на Profile), затем тот же вызов без `--dry-run`.

Одна оговорка для задач 52. Чтобы Profile сработал, scaffold задачи обязан запускать `lib/plugin-state/*.sh`, как
велит шаблон `harness/evals-outcome/README.md`. Если plugin-state не отработал, скрипт Profile-я выходит с кодом 1.
Run тогда падает, а не идёт молча с Profile-ем `full`.

### Замер ожидания (пункт 4), 2026-10-16 .. 2026-10-29

`node scripts/agent-cost.mjs --waits --since 2026-10-16 --until 2026-10-29`, все транскрипты репозитория и его
worktree (только чтение):

- 774 из 16 343 ответов Orchestrator-а (4,7 %) идут сразу после ожидания. Это 182,4 млн token-ов (4,9 % token-ов
  Orchestrator-а) и $51,27 по прайсу API из $5 626,93 за период;
- из них после фоновой команды или Monitor — 707 ответов ($46,96), после ожидания CI — 67 ответов ($4,31);
- отдельно: 1 579 ответов (9,7 %, $148,41) — сразу после notice «subagent закончил»; это не ожидание.

Доля ожидания мала, нового Ticket-а не предлагаю. Заметнее ответы после «subagent закончил»: их вдвое больше. Если
резать ходы Orchestrator-а, то там — собирать результаты нескольких subagent-ов одним ответом.

### Не сделано

- Пункт 3 (повторный замер до и после `eco`, цель L2 для Pro) — не в этом PR. В Profile worfy `eco` не включён:
  поля `workflow.agents` нет, то есть `full`.
- Режим сравнения на настоящих задачах — после `worfy-harness` 52.
