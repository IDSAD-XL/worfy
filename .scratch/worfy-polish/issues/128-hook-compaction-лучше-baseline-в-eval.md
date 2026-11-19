# 128 — Hook compaction: eval `compaction-state` с hook-ом лучше, чем без него

Type: task
Status: open
Blocked by: none
Source: владелец 2026-11-19 на приёмке worfy-continuity 15: пункт 8 «Готово, когда» spec-а (eval `compaction-state`
показывает, что с hook-ом лучше) принят как есть, «плюс Ticket на переделку hook-а».

Кто: агент. Платный eval — по правилу evals: сначала `--dry-run`, потолок на вызов.

## Что происходит

- После compaction (сжатия разговора в summary) Harness возвращает агенту состояние работы двумя путями:
  - hook `PreCompact` (`harness/hooks/inject-rules.mjs compaction`, правила `harness/hooks/rules/compaction.md`) —
    инструкции для summary;
  - hook `SessionStart` ветки `compact` (`harness/hooks/after-compact.mjs`) — файл Ticket-а и `git status --short`
    implementer-у, `wave-brief` Orchestrator-у;
  - пункт «After a compaction…» в `harness/hooks/rules/common.md`.
- Eval `harness/evals/compaction-state/` (Ticket worfy-continuity 13) сравнивает Harness с этими hook-ами и копию без
  них (`baseline.mjs`). Шесть probes (вопросов после compaction) судит haiku, три run-а на вариант.
- Раунд 3 (2026-11-18, head 98a0cc68d; таблица — «Итог» Ticket-а worfy-continuity 13): с hook-ом хуже, чем без него.

  | | с hook-ом | без hook-а |
  |---|---|---|
  | overallScore | 0,64 | 0,73 |
  | probe о Ticket-е | 1/3 | 1/3 |
  | probe о пунктах «Готово, когда» | 1/3 | 0/3 |
  | probe о следующем шаге | 1/3 | 3/3 |

- Причины, которые «Итог» 13 называет, но не проверил (trace-ы run-ов удалены):
  - run 2 с hook-ом не ответил: «Autocompact is thrashing». Вероятно, порог кейса 5 % от окна 100000 (5 тыс.
    токенов) ниже контекста после compaction (около 9,7 тыс.), и каждый лишний turn снова сжимает разговор;
  - ответившие run-ы с hook-ом называют fix `exports`, но не повторный `node --test`. Без hook-а все три называют оба
    шага. Почему, не установлено;
  - судья ошибается в обе стороны (probe-ticket, probe-goal), а три run-а на вариант не различают разницу в один run.

## Что делаем

1. Повторить оба варианта с сохранёнными trace-ами и понять, откуда провал: механика кейса (порог, thrash), текст
   `compaction.md`, текст `after-compact.mjs` или судья.
2. Исправить кейс, если виновата механика: порог compaction без thrash (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` и окно в
   `scripts/eval-harness.mjs:105`), число run-ов, при котором разница видна (`--runs`), и критерии судьи
   (`harness/evals/compaction-state/graders/probe-*.md`).
3. Переделать hook и правила так, чтобы после compaction агент знал Ticket, пункты «Готово, когда» с состоянием и
   следующий шаг. Например: `after-compact.mjs` называет следующий шаг из ticket-файла и `git status`, а
   `compaction.md` просит сохранить последнюю красную команду и что запустить после fix.
4. Прогнать eval с hook-ом и `HARNESS_DIR="$(node harness/evals/compaction-state/baseline.mjs)"` без него. Числа обоих
   вариантов, команды и путь к результатам — в «Итог».

## Где в коде

- `harness/hooks/after-compact.mjs` — текст после compaction (`:195` implementer, `:213` Orchestrator).
- `harness/hooks/rules/compaction.md`, `harness/hooks/rules/common.md`, `harness/hooks/inject-rules.mjs`,
  `harness/hooks/hooks.json` (`PreCompact` и `SessionStart` с matcher-ом `compact`).
- `harness/evals/compaction-state/` — `case.yaml`, `prompt.md`, `probes.md`, `history.mjs`, `scaffold.sh`,
  `baseline.mjs`, `graders/`.
- `scripts/eval-harness.mjs:105` — переменные compaction кейса.
- Test-ы: `harness/hooks/tests/session-hooks.test.sh` (раздел after-compact), `harness/hooks/tests/rules-hooks.test.sh`
  (PreCompact и `compaction.md`), `test/contract/harness-evals.test.ts` (кейс полон, fixture строится).

## Готово, когда

- [ ] Eval `compaction-state` с hook-ом выше baseline по overallScore.
- [ ] С hook-ом выше baseline по каждой группе probes: Ticket, пункты «Готово, когда», следующий шаг.
- [ ] Log прогона обоих вариантов (команды, overallScore, баллы по probes, цена) — в «Итог».
- [ ] Shell test-ы hook-ов и contract test eval-а зелёные; CI зелёный.
