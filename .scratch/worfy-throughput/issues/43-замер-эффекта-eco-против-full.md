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

- [ ] Сначала падающий test режима сравнения на подставном `claude` (`test/contract/harness-evals-outcome.test.ts`): два run-а получают разные Profile, итог
      содержит обе оценки и token-ы; `--max-cost-usd` по-прежнему обязателен.
- [ ] Test `--waits` в `test/unit/agent-cost.test.ts` на фикстуре: вызов после результата фоновой команды
      считается ожиданием, обычный — нет.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; условие merge — `ci-ok`.
- [ ] (вручную, с «да» владельца и ценой из команды, которую eval реально запустит) Платный run `eco` против
      `full`: оценки, token-ы, цена — в «Итог». Не закрывается, пока `worfy-harness` 52 не дал задачи.
- [ ] Режим сравнения на настоящих задачах `harness/evals-outcome/` — тоже только после `worfy-harness` 52.
- [ ] «Итог»: повторный замер шага 3 и ответ — выполнена ли цель L2 spec-а для Pro (в 5–20 раз меньше).

## Где в коде

- `scripts/eval-outcome.mjs`, `scripts/eval-outcome-score.mjs`
- `scripts/agent-cost.mjs`, `test/unit/agent-cost.test.ts`
- Только читать: `harness/evals-outcome/README.md`

## Вне скоупа

- Задачи eval исхода — `worfy-harness` 52. Повторный замер критического пути — Ticket 05.

## Итог
