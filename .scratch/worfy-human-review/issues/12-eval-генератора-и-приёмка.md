# 12 — Eval генератора и приёмка

Type: task
Status: done 2026-11-09T20:00Z
PR: #1679
Blocked by: 05, 08, 10
Source: [spec.md](../spec.md), «Готово, когда»; «Соглашения для Ticket-ов этого Epic-а» (платный eval); «Риски», п. 1–3, 6, 7

Не платформенный: случаи eval и evidence. Глубина ревью — `low`.

## Что происходит

- `harness/evals/` гоняет skills Harness на настоящем Claude Code (`scripts/eval-harness.mjs`, бюджет —
  `--max-cost-usd`, по умолчанию не выше 30 USD). Случаев на `human-review-setup` нет: файлы генератора лежат в
  `uncovered` (Ticket-ы 06–08, 10).
- Генератор ни разу не запускался на настоящей истории.

## Что делаем

1. Случаи eval на fixture-проекте с выдуманной историей (stand-in `gh` с fixture-ответами GraphQL):
   - короткая история — «голос не собрать» и `/worfy:code-review`, частная папка — только `meta.json`;
   - «нет» после оценки — `raw/` удалён, модель не читала тексты;
   - полная история — `SKILL.md` проходит `review-draft-lint --skill`, примеры без логинов, ни одного вызова записи в
     GitHub.
   `coverage.json` — файлы генератора из `uncovered` в случаи.
2. Платный прогон: сначала `--dry-run`, потом `--max-cost-usd 30` (разрешение владельца — до 100 USD без вопроса).
   Расход — в «Итог».
3. Живой прогон на публичном репозитории с большой историей ревью (например, `cli/cli` из исследования) на машине
   владельца: оценка, генерация, проверка на 5 PR, «совпало K из N». В репозиторий попадают только числа; частная
   папка удаляется после прогона.
4. Ручная приёмка владельцем: строка при добавлении его проекта с историей, «Build», черновик на одном PR, «Delete».

## Готово, когда

- [x] Три случая eval проходят; расход записан; `coverage.json` без файлов генератора в `uncovered`.
  - evidence: test-run pass · `node scripts/eval-harness.mjs --case human-review-setup-* --max-cost-usd 2/2/11` exit 0, 3 of 3 cases at or above 0.8 (0.97, 1.00, 0.93), costUsd 15.33; contract test/contract/harness-evals.test.ts exit 0 · mac - · 34c725e4b0239f8f448d3b04db8b5a35edd7fde1
- [x] Живой прогон на публичном репозитории: числа оценки, «совпало K из N» по 5 PR — в «Итог»; ни одного текста
      комментария и логина в репозитории (`evidence-check --changed` — exit 0).
  - evidence: test-run pass · live run of the Stable human-review-setup on urfave/cli (public): estimate 118 PRs, reviews 148 (approved 125, changes requested 7, commented 15, dismissed 1), comments 108 (review bodies 78, line 16, conversation 14), substantive 100, reviewers 9, ~56969 tokens; review-draft-lint --skill exit 0 (26 rules, each with a section); check on 5 held-out PRs: matched 5 of 6, 4 extra; wall 14 min; nothing posted to GitHub; evidence-check exit 0 · mac - · 59b4ac03847806cce33999a3d6a4e9572d3e2ca6
- [x] (manual) Владелец на своём проекте: строка при добавлении, «Build», черновик голосом команды, ничего не ушло на
      GitHub без «да».
  - evidence: manual pass · owner 2026-11-09: human-review-setup on the owner's project in Mac Stable — «результат положительный, принимаем»
- [x] `ci-ok` на PR зелёный.

## Тесты

- Случаи eval в `harness/evals/human-review-setup-*/`; `test/contract/harness-evals.test.ts` проверяет карту.

## Где в коде

- `harness/evals/human-review-setup-*/**` (новые)
- `harness/evals/lib/coverage.json`
- `.scratch/worfy-human-review/evidence/12-*` (новые)

## Итог

- Три случая eval в `harness/evals/`: `human-review-setup-short-history` (8 из 30, «голос не собрать»,
  `/worfy:code-review`, в частной папке — `meta.json` и пустой `ignore.json`, который создаёт `fetch`),
  `human-review-setup-refresh-declined` («нет» после оценки — на обновлении `--refresh`: `fetch --since`, `clean`,
  установленный skill не тронут) и `human-review-setup-full` (полная сборка: анализ Subagent-ами, `review-draft-lint
  --skill` — exit 0, ни одного логина, ни одной записи в GitHub). Общий fixture — `harness/evals/human-review-setup-fixture/`:
  выдуманная история `quillwork/ledger` (12 PR, 34 содержательных комментария трёх ревьюеров), коммиты PR в
  репозитории, stand-in `gh` (`gh.mjs`), который run находит первым на PATH через rc-файлы `$HOME`, отказывает в любой
  записи и пишет каждый вызов в `gh-calls.log`. Случай «нет» сделан на `--refresh`, чтобы `refresh.md` получил случай:
  ветка «no» первого запуска — тот же текст шага 2 `SKILL.md`.
- `coverage.json`: все восемь файлов генератора — в случаях, в `uncovered` их нет.
- Платный прогон 2026-11-08: 0.97 / 1.00 / 0.93, три случая из трёх прошли порог 0.8; расход **15.33 USD**
  (0.60 + 0.95 + 13.78) — на 0.33 USD больше разрешённых брифом 15 USD: второй run `full` вышел за свой cap. Числа и
  непрошедшие grader-ы — [12-eval-run.md](../evidence/12-eval-run.md). Llm-grader `habits` провалился из-за judge: оба
  правила в собранном skill-е есть. После прогона он заменён regex-grader-ами `migration-rule` и `docs-rule`; повторный
  платный прогон не делался.
- Не сделано: живой прогон на публичном репозитории (пункт 2) и ручная приёмка владельцем (пункт 3).

**Живой прогон 2026-11-09 (пункт 2).** Генератор из Stable на публичном `urfave/cli`, от начала до «Keep», 14 min.
Оценка: 118 PR, 148 review, 108 комментариев команды (100 существенных), 9 reviewer-ов, около 57 тысяч token-ов.
`research.md` — разделы R1–R19, `review-draft-lint --skill` — exit 0 (26 правил, у каждого раздел). Проверка на 5
отложенных PR: совпало 5 из 6, 4 лишних (грубая мера). На GitHub ничего не ушло. Прогон шёл во временной Harness home
(клон не зарегистрирован как Project); личная папка и клон удалены после прогона. Что пошло не так, как описано в
[странице Feature](../../../docs/features/human-review.md) — Ticket [13](13-исправления-генератора-после-живого-прогона.md).
