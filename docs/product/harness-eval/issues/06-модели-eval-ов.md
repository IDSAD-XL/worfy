# 06 — На каких моделях идут eval-ы

Type: grilling
Status: done 2026-11-24T19:05Z
Blocked by: 02
Source: [research-модели-и-расход-за-30-дней.md](../research-модели-и-расход-за-30-дней.md);
`scripts/eval-run-env.mjs:32-33`; [research-текущие-eval-ы.md](../research-текущие-eval-ы.md), раздел 4

## Question

Агент eval-ов закреплён на `claude-sonnet-5`, judge — на `claude-haiku-4-5` (`scripts/eval-run-env.mjs:32-33`).
Менять ли их?

- За 30 дней на `claude-sonnet-5` пришлось 0,1 % сообщений владельца, на `claude-opus-5-5` — 85 %.
- `claude-opus-5-5` вдвое дороже: 4 / 20 USD за 1M token-ов на вход и выход против 2 / 10 у Sonnet. `claude-sonnet-5-5`
  стоит столько же, сколько `claude-sonnet-5`.
- Judge `claude-haiku-4-5` трижды ошибался так, что grader приходилось переписывать. Его доля в цене run-а — 0,3 %.
- Смена модели меняет все оценки. Менять её стоит до первого полного прогона, который станет точкой отсчёта.

## Answer

Владелец 2026-11-24: «да».

- Регулярные прогоны — полный набор, срабатывание, новые case-ы, `--changed` — идут на `claude-sonnet-5-5`, по той же
  цене, что `claude-sonnet-5`.
- Пилот 52 идёт на `claude-opus-5-5`: он отвечает, лучше ли с worfy, а работа владельца идёт на Opus. Цена пилота —
  68–154 USD.
- Judge — `claude-opus-5-5` вместо `claude-haiku-4-5`, и в `eval:harness`, и в scorer-е outcome eval. Доля judge в
  цене — около 1 %.
- Модели меняются до первого полного прогона, который станет точкой отсчёта.
