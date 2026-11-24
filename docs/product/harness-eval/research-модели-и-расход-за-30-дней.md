# Модели работы владельца и расход на eval-ы за 30 дней — research

Подсчёт 2026-11-24 на Mac владельца.

## Какие модели вели работу

Источник: transcript-ы Claude Code `~/.claude/projects/**/*.jsonl`, изменённые за 30 дней. Считались строки с полем
`"model"` — сообщения модели, вместе с subagent-ами. Run-ы eval-ов сюда не попадают: у них временный HOME.

| Модель | Сообщений | Доля |
| --- | --- | --- |
| `claude-opus-5-5` | 664 491 | 85 % |
| `claude-opus-5` | 80 587 | 10 % |
| `claude-sonnet-5-5` | 23 103 | 3 % |
| `claude-fable-5-1`, `claude-fable-5`, `claude-fable-5-2` | 12 944 | 1,7 % |
| `claude-sonnet-5` | 724 | 0,1 % |
| `claude-haiku-5-5`, `claude-haiku-4-5` | 287 | меньше 0,1 % |

Агент eval-ов закреплён на `claude-sonnet-5` (`scripts/eval-run-env.mjs:32`). В работе владельца эта модель почти не
встречается.

## Сколько стоят eval-ы по PR

Источник: логи run-ов Orchestrator-а `~/Stuff/worfy-orch/eval-*.log`, изменённые за 30 дней. Это 23 файла и 38 вызовов
`claude plugin eval`. Сумма `costUsd` — **50.23 USD** по прайс-листу, последний лог — 2026-11-16.

Это нижняя граница. Часть run-ов шла из worktree Ticket-ов и в эти логи не попала. Например, отладка case-ов Ticket-ов
worfy-polish 128 (16.96 USD) и worfy-pr-review 08 (8.83 USD) в ноябре
([research-текущие-eval-ы.md](research-текущие-eval-ы.md), раздел «Цена и время»).

## Цены моделей

Прайс-лист Claude API на 2026-11-03, USD за 1M token-ов, вход / выход:

- `claude-opus-5-5` — 4 / 20;
- `claude-sonnet-5-5` и `claude-sonnet-5` — 2 / 10;
- `claude-haiku-4-5` — 1 / 5; `claude-haiku-5-5` — 0,10 / 0,50.
