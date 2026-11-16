# 14 — Eval-сценарий implementer-а: story PR на учебном Ticket-е проходит `story-check`

Type: task
Status: claimed 2026-11-16T13:28Z
Blocked by: 05
Source: [spec.md](../spec.md), «Ticket-ы», строка 14; «Решения владельца» 21 (строки 123–124); «Решения по test-ам», В
(строки 285–289); «Риски»: «Отказ `reasoning_extraction`», «Codex» (строки 346–356); «Готово, когда» spec-а, пункт eval
(строка 383); истории 29–31

Кто: агент. Платный запуск — руками, на Mac, с правилом eval-ов до 100 USD.

## Что происходит

- Поведение implementer-а test-ом не ловится. Story PR пишет implementer по шагу `ship-ticket` (Ticket 05). Плохую story
  поймает guard, но только на настоящем PR.
- Eval-сценарии Harness-а — `harness/evals/<case>/` (`case.yaml`, `prompt.md`, `scaffold.sh`, `graders/`); образец —
  `harness/evals/implementer-report`. Запуск — `pnpm eval:harness` (`scripts/eval-harness.mjs`). Это настоящие
  вызовы модели на аккаунте владельца, руками, на Mac, не в CI и не в gate (комментарий в начале script-а). `--dry-run`
  ничего не тратит: проверяет аргументы и печатает план вызовов. `--max-cost-usd` снижает бюджет run-а.
- Связь сценария с файлами Harness-а — `harness/evals/lib/coverage.json`, её сверяет `scripts/eval-harness-coverage.mjs`.

## Что делаем

1. Новый сценарий `harness/evals/implementer-story/` рядом с `implementer-report`:
   - `scaffold.sh` собирает учебный repo с маленьким Ticket-ом и `code_stories.pr` включено;
   - `prompt.md` даёт implementer-у Ticket;
   - graders проверяют:
     - в ветке есть `stories/NN-*.md`;
     - `story-check` по ней — exit 0;
     - в story есть обязательные части: первый шаг «что было не так», поля каждого шага, «не записано» вместо
       придуманной причины там, где учебный Ticket причины не даёт;
     - в transcript-е нет отказа `reasoning_extraction`.
2. Строка в `harness/evals/lib/coverage.json`: сценарий покрывает файлы шага story в `ship-ticket` и `implementer.md`.
3. **Запуск — только руками, никогда в CI.**
   - Сначала `pnpm eval:harness -- --case implementer-story --dry-run`: прочитать план и строки по каждому вызову.
   - Потом платный запуск с `--max-cost-usd` ниже 100. Если цена выше 100 USD — спросить владельца.
4. Результат — цена, число run-ов, какие graders прошли — записать в «Итог». Codex этим eval-ом не проверяется: его
   проверит первый Ticket на Codex.

## Готово, когда

- [ ] `harness/evals/implementer-story/` с `case.yaml`, `prompt.md`, `scaffold.sh` и graders; `node
      scripts/eval-harness-coverage.mjs` — exit 0.
  - evidence: test-run pass · `node scripts/eval-harness-coverage.mjs` exit 0 · mac - · b1bb184b224bfcecaf69deda07ce4fee2d615f33
- [ ] Четыре grader-а в `graders/`, по одному на проверку п. 1: файл story есть, `story-check` — exit 0, обязательные
      части на месте, отказа `reasoning_extraction` нет. Тип — как у `implementer-report/graders` (`regex` по файлу,
      где его хватает).
  - evidence: test-run pass · `npx vitest run --project contract test/contract/harness-evals-story.test.ts` exit 0 · mac - · b1bb184b224bfcecaf69deda07ce4fee2d615f33
- [ ] Dry run `pnpm eval:harness -- --case implementer-story --dry-run` — exit 0; план вызовов в «Итог».
  - evidence: test-run pass · `pnpm eval:harness -- --case implementer-story --dry-run` exit 0 · mac - · b1bb184b224bfcecaf69deda07ce4fee2d615f33
- [ ] (manual) Платный run руками с `--max-cost-usd` ниже 100: graders зелёные; цена и число run-ов в «Итог».
- [ ] Сценарий не входит ни в один workflow CI и ни в gate (grep по `.github/workflows` и `harness/hooks/gate.mjs`
      пустой).
  - evidence: test-run pass · `grep -rn implementer-story .github/workflows harness/hooks/gate.mjs` exit 1 (no match) · mac - · b1bb184b224bfcecaf69deda07ce4fee2d615f33

## Тесты

- Сам eval — руками; в CI и gate его нет.

## Где в коде

- `harness/evals/implementer-story/` (новая папка: `case.yaml`, `prompt.md`, `scaffold.sh`, `graders/`)
- `harness/evals/lib/coverage.json`

Только читать: `harness/evals/implementer-report/`, `scripts/eval-harness.mjs`, `scripts/eval-harness-coverage.mjs`.

## Вне скоупа

- Eval агента story Epic-а и story по кнопке: их проверяет приёмка (Ticket 17).

## Итог

- Сценарий `harness/evals/implementer-story/`: ticket 01 учебного Epic-а `demo` (finish `pr-green-ci`) уходит агенту
  `worfy:implementer`. Scaffold переписывает ticket 01 так, что два его правила без причины, явно ставит
  `code_stories.pr: on` и кладёт post-commit hook: после каждого commit-а со story в HEAD он запускает `bin/story-check`
  и пишет вывод и `EXIT=<код>` в `.git/story-check.log`. У `claude plugin eval` нет grader-а, который запускает команду,
  поэтому exit code проверки читается из этого файла, а не из слов implementer-а.
- Graders: `story-in-branch` (story в commit-е по пути `.scratch/demo/stories/01-alpha.md`), `story-check-green`
  (`EXIT=0`), `story-required-parts` (первый шаг «Что было не так», фрагмент, пять полей, `не записано`, нет шага
  review), `no-refusal` (нет отказа `reasoning_extraction` в trace), плюс `implementer-dispatched` (`tool_used`: его
  требует contract test каждого сценария).
- Dry run `pnpm eval:harness -- --case implementer-story --dry-run` — exit 0. План: один вызов `main-implementer-story` —
  `claude plugin eval <plugin-copy> --scaffold --trust-plugin --ablation none --threshold 0.8 --no-publish --model
  claude-sonnet-5 --judge-model claude-haiku-4-5 --max-cost-usd 30 --tag main --case implementer-story --allow-tools Bash
  Write Edit`; 3 run-а (`runs: 3`), вызов gui пропущен. Цены по вызову dry run не печатает; оценка — 1–1.5 USD за run
  (`implementer-report` стоил 0.45 USD за run, здесь implementer ещё пишет story и проходит gate), 3–5 USD за вызов.
- Платный run (пункт 4) — за владельцем: `pnpm eval:harness -- --case implementer-story --max-cost-usd 10`.
