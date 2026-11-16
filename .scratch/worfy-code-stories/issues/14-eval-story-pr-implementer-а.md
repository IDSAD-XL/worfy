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
  - evidence: test-run pass · `node scripts/eval-harness-coverage.mjs` exit 0 · mac - · ca361a7574821b99d3fb9bce1cc833d674ab090e
  - evidence: test-run pass · `node scripts/eval-harness-coverage.mjs` exit 0 · mac - · 37cb452d6921d4e48004080eef1b174bb697de7b
  - evidence: test-run pass · `node scripts/eval-harness-coverage.mjs` exit 0 · mac - · e0b0497bba34ab04f42660b383a37e913505ae5e
- [ ] Четыре grader-а в `graders/`, по одному на проверку п. 1: файл story есть, `story-check` — exit 0, обязательные
      части на месте, отказа `reasoning_extraction` нет. Тип — как у `implementer-report/graders` (`regex` по файлу,
      где его хватает).
  - evidence: test-run pass · `npx vitest run --project contract test/contract/harness-evals-story.test.ts` exit 0 · mac - · b1bb184b224bfcecaf69deda07ce4fee2d615f33
  - evidence: test-run pass · `npx vitest run --project contract test/contract/harness-evals-story.test.ts` exit 0 · mac - · ca361a7574821b99d3fb9bce1cc833d674ab090e
  - evidence: test-run pass · `npx vitest run --project contract test/contract/harness-evals-story.test.ts` exit 0 · mac - · 37cb452d6921d4e48004080eef1b174bb697de7b
  - evidence: test-run pass · `npx vitest run --project contract test/contract/harness-evals-story.test.ts` exit 0 · mac - · e0b0497bba34ab04f42660b383a37e913505ae5e
- [ ] Dry run `pnpm eval:harness -- --case implementer-story --dry-run` — exit 0; план вызовов в «Итог».
  - evidence: test-run pass · `pnpm eval:harness -- --case implementer-story --dry-run` exit 0 · mac - · b1bb184b224bfcecaf69deda07ce4fee2d615f33
  - evidence: test-run pass · `pnpm eval:harness -- --case implementer-story --dry-run` exit 0 · mac - · ca361a7574821b99d3fb9bce1cc833d674ab090e
  - evidence: test-run pass · `pnpm eval:harness -- --case implementer-story --dry-run` exit 0 · mac - · 37cb452d6921d4e48004080eef1b174bb697de7b
  - evidence: test-run pass · `pnpm eval:harness -- --case implementer-story --dry-run` exit 0 · mac - · e0b0497bba34ab04f42660b383a37e913505ae5e
- [ ] (manual) Платный run руками с `--max-cost-usd` ниже 100: graders зелёные; цена и число run-ов в «Итог».
- [ ] Сценарий не входит ни в один workflow CI и ни в gate (grep по `.github/workflows` и `harness/hooks/gate.mjs`
      пустой).
  - evidence: test-run pass · `grep -rn implementer-story .github/workflows harness/hooks/gate.mjs` exit 1 (no match) · mac - · b1bb184b224bfcecaf69deda07ce4fee2d615f33
  - evidence: test-run pass · `grep -rn implementer-story .github/workflows harness/hooks/gate.mjs` exit 1 (no match) · mac - · ca361a7574821b99d3fb9bce1cc833d674ab090e
  - evidence: test-run pass · `grep -rn implementer-story .github/workflows harness/hooks/gate.mjs` exit 1 (no match) · mac - · 37cb452d6921d4e48004080eef1b174bb697de7b
  - evidence: test-run pass · `grep -rn implementer-story .github/workflows harness/hooks/gate.mjs` exit 1 (no match) · mac - · e0b0497bba34ab04f42660b383a37e913505ae5e

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
  `code_stories.pr: on`, создаёт bare origin в `.git` с `worktree.base` `origin/main` и кладёт
  `.git/eval-finish.sh`. Сессия запускает этот скрипт последним шагом, после отчёта implementer-а. Скрипт запускает
  `bin/story-check` и пишет `.git/story-check.log`: story ticket-а 01 из HEAD, строку `=== story-check ===`, строку
  `in-branch:` для story, которую ветка добавила с `main`, вывод и `EXIT=<код>`; копию story из HEAD он кладёт в
  `.git/story-check/`. У `claude plugin eval` нет grader-а, который запускает команду, поэтому exit code проверки
  читается из этого файла, а не из слов implementer-а.
- Graders (четыре, порог 0.8: любой один красный валит сценарий, 3/4 = 0.75):
  - `story-check-green` — один regex по log-у: части из `story-pr.md` (заголовок, `Kind: pr`, `Language: ru`, первый
    шаг «Что было не так», фрагмент, пять полей, нет шага review), story ветки `demo/01` по пути
    `.scratch/demo/stories/01-alpha.md` и `EXIT=0`. Пункт «Готово, когда» просил отдельные graders «файл есть»,
    «exit 0» и «части на месте»; при пяти grader-ах один красный давал 4/5 = 0.8, и сценарий проходил (review круг 1),
    поэтому три проверки — один regex.
  - `no-invented-reason` — `llm` по копии story, с полным текстом ticket-а и правилами учебного проекта: ни одно поле
    code step-а не называет причину или факт, которых нет в ticket-е, в правилах и в цитате кода, а где причина
    нужна — `не записано`. Regex этого не различает.
  - `no-refusal` — нет отказа `reasoning_extraction` в trace.
  - `implementer-dispatched` — `tool_used`: его требует contract test каждого сценария.
- Dry run `pnpm eval:harness -- --case implementer-story --dry-run` — exit 0. План: один вызов `main-implementer-story` —
  `claude plugin eval <plugin-copy> --scaffold --trust-plugin --ablation none --threshold 0.8 --no-publish --model
  claude-sonnet-5 --judge-model claude-haiku-4-5 --max-cost-usd 30 --tag main --case implementer-story --allow-tools Bash
  Write Edit`; 3 run-а (`runs: 3`), вызов gui пропущен. Цены по вызову dry run не печатает.
- Платные run-ы 2026-11-16, все `claude-sonnet-5`:
  - head f0e1df8a3, 3 run-а, 2.53 USD — 0.50 в каждом: log-а нет. Preflight ответил BLOCKED «no remote origin, and
    workflow.finish is pr-green-ci», implementer закончил локально и story не писал. Исправлено: bare origin.
  - диагностика 1, 1 run, 0.83 USD — story и commit есть, log-а нет.
  - диагностика 2, 1 run, 1.06 USD — post-commit hook не сработал: Claude Code запускает git с выключенными hook-ами
    репозитория. Исправлено: скрипт `.git/eval-finish.sh`, который запускает сессия.
  - proof run head 75424fc1f, 3 run-а, 3.13 USD — 0.75 в каждом: `story-check-green` зелёный везде, прежний regex
    `story-required-parts` красный везде — он требовал `не записано`, а ни одна story его не написала. Две story из трёх
    придумали факты, которых нет в ticket-е («percent — единственная функция, которую вызывает отчёт», «в отчёте такие
    значения не встречаются»). Исправлено: regex заменён на `llm` grader `no-invented-reason`, структура story ушла в
    `story-check-green`.
  - run координатора на 619762e1a не стартовал (0 USD): CLI 2.1.323 режет frontmatter regex-ом
    `/^---\s*\n([\s\S]*?)---\s*\n?/`, на первых трёх дефисах где угодно, а `pattern` содержал `--- story-check ---`.
    Исправлено: разделитель `=== story-check ===`, contract test режет frontmatter каждого `.md` в `harness/evals`
    regex-ом CLI. `llm` grader теперь получает весь Ticket и правила учебного проекта.
  - Всего 7.55 USD. Proof run исправленного head-а — за владельцем:
    `pnpm eval:harness -- --case implementer-story --keep-temp --max-cost-usd 10`. По proof run-у он, скорее всего,
    упадёт на `no-invented-reason` (implementer придумывает причины в 2 из 3 run-ов) — это пробел в поведении
    implementer-а по `story-pr.md`, не в сценарии.
