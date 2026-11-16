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
- [ ] Четыре grader-а в `graders/`, по одному на проверку п. 1: файл story есть, `story-check` — exit 0, обязательные
      части на месте, отказа `reasoning_extraction` нет. Тип — как у `implementer-report/graders` (`regex` по файлу,
      где его хватает).
- [ ] Dry run `pnpm eval:harness -- --case implementer-story --dry-run` — exit 0; план вызовов в «Итог».
- [ ] (manual) Платный run руками с `--max-cost-usd` ниже 100: graders зелёные; цена и число run-ов в «Итог».
- [ ] Сценарий не входит ни в один workflow CI и ни в gate (grep по `.github/workflows` и `harness/hooks/gate.mjs`
      пустой).

## Тесты

- Сам eval — руками; в CI и gate его нет.

## Где в коде

- `harness/evals/implementer-story/` (новая папка: `case.yaml`, `prompt.md`, `scaffold.sh`, `graders/`)
- `harness/evals/lib/coverage.json`

Только читать: `harness/evals/implementer-report/`, `scripts/eval-harness.mjs`, `scripts/eval-harness-coverage.mjs`.

## Вне скоупа

- Eval агента story Epic-а и story по кнопке: их проверяет приёмка (Ticket 17).
