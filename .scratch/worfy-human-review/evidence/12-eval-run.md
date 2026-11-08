# 12 — платный прогон eval генератора, 2026-11-08

`node scripts/eval-harness.mjs --case <случай> --max-cost-usd <cap>`, три отдельных вызова, без `GH_TOKEN` в окружении;
claude 2.1.289, модель `claude-sonnet-5`, judge `claude-haiku-4-5`, порог случая 0.8. Сначала `--dry-run` — exit 0.
История ревью — выдуманная (`quillwork/ledger`), GitHub — stand-in `gh` fixture-а; в этом файле только числа.

| Случай | cap, USD | Run-ы | Score по run-ам | Score случая | Расход, USD | Exit |
| --- | --- | --- | --- | --- | --- | --- |
| `human-review-setup-short-history` | 2 | 3 | 1.00, 0.90, 1.00 | 0.97 | 0.60 (0.24 + 0.18 + 0.18) | 0 |
| `human-review-setup-refresh-declined` | 2 | 3 | 1.00, 1.00, 1.00 | 1.00 | 0.95 (0.26 + 0.36 + 0.33) | 0 |
| `human-review-setup-full` | 11 | 2 | 0.93, 0.93 | 0.93 | 13.78 (8.75 + 5.03) | 0 |

Итого: три случая из трёх прошли порог, расход **15.33 USD**. Cap третьего вызова — 11 USD; второй run начался с
остатком 2.25 USD и закончился на 5.03 USD: ceiling claude не остановил run на остатке, перерасход 2.78 USD
(почему — не выяснено). Предварительное разрешение было до 15 USD — превышено на 0.33 USD.

Первая попытка `short-history` (до исправления fixture-а) упала в scaffold-е во всех трёх run-ах, модель не
вызывалась, расход 0.00: `git init` в scaffold-е `claude plugin eval` не создаёт `.git/info/`.

Что не прошло:

- `short-history`, run 2: `n-of-30` — в последнем сообщении нет слов «8 of 30». Последним действием prompt просит
  сохранить список частной папки, и ответ мог закончиться им; transcript прошедшего run-а не сохраняется, причина
  не проверена.
- `full`, run 1: `habits` (llm judge `claude-haiku-4-5`, FAIL ×3 на `SKILL.md` в 11 232 символа) — ошибся judge, а не
  генератор: в этом `SKILL.md` есть оба правила — «migrations/: a down migration that fully reverses the up
  migration — the most-repeated blocker in the window (28.6% of migrations/ comments). [R15]» и «Do not raise
  anything about docs-only edits — typo fixes, linter version bumps — the team approves these without a word every
  time it has seen one alone in the window. [R19]». После прогона grader `habits` заменён двумя regex-grader-ами
  (`migration-rule`, `docs-rule`); на этом тексте (`test/fixtures/human-review-setup/built-SKILL.md`) они проходят,
  а без этих правил — нет (contract test). Run 2: `habits` пропущен по cost ceiling.

Остальные grader-ы — во всех run-ах: fetch через stand-in, ни одной записи в GitHub (`gh-calls.log` без `WRITE`,
ни одной команды записи `gh`), Subagent-ы анализа (11 и 5 вызовов `Agent`), `review-draft-lint --skill` на
установленном skill-е — `EXIT=0`, нет `{{` шаблона, нет ни одного логина в `SKILL.md`, `voice-examples.md` и
`research.md`, `research.md` начинается разделом `## R1 — Triage: approved without comments`, `raw/` удалён
(`review-history clean`).
