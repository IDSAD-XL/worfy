# Code story — worfy-code-stories 14: Eval-сценарий implementer-а: story PR на учебном Ticket-е проходит `story-check`

Kind: pr · Epic: worfy-code-stories · Ticket: 14 · PR: - · Language: ru

## 1. Что было не так

Story PR пишет implementer по шагу `ship-ticket` (Ticket 05), но ни один test не проверяет, что он это делает. Guard
в `land` ловит плохую story только на настоящем PR. Eval-сценария, где implementer пишет story на учебном Ticket-е,
не было: в `coverage.json` файл `story-pr.md` числился без сценария.

- Требование: [Что происходит](../issues/14-eval-story-pr-implementer-а.md#что-происходит)

## 2. Exit code `story-check` записывает скрипт fixture-а, а не implementer

Code: `harness/evals/implementer-story/scaffold.sh:111-120` · key lines: 113, 114, 117, 118

```sh
in_branch=$(git diff --name-only --diff-filter=AM main...HEAD -- .scratch/demo/stories 2>/dev/null)
{
    git show HEAD:.scratch/demo/stories/01-alpha.md 2>/dev/null
    echo '--- story-check ---'
    printf 'stories: %s\n' $stories
    [ -z "$in_branch" ] || printf 'in-branch: %s\n' $in_branch
    node '@STORY_CHECK@' $stories
    echo "EXIT=$?"
} >"$common/story-check.log" 2>&1
exit 0
```

- Что делает: `.git/eval-finish.sh`, который сессия запускает последним шагом после отчёта implementer-а, заново пишет
  `.git/story-check.log`: story Ticket-а 01 из HEAD, строку `--- story-check ---`, story, которые ветка добавила с
  `main` (`in-branch:`), вывод `story-check` этой копии Harness-а и `EXIT=<код>`.
- Почему здесь: у `claude plugin eval` нет grader-а, который запускает команду; есть `regex`, `tool_used`,
  `file_exists`, `llm` по файлу или transcript-у. Свой запуск `story-check` implementer-ом — утверждение его отчёта,
  а не проверка. Git hook не годится: Claude Code запускает git с выключенными hook-ами репозитория, и во втором
  диагностическом run-е hook не сработал ни разу.
- Без него: grader «`story-check` — exit 0» читал бы слова implementer-а, а не результат проверки.
- Требование: [Что делаем, п. 1](../issues/14-eval-story-pr-implementer-а.md#что-делаем)
- Риски и пробелы test-ов: скрипт запускает сессия по prompt-у; если она его не запустит, log-а нет, и сценарий
  падает, а не проходит. Ветка сравнивается с `main` учебного repo.

## 3. Структура story и зелёный `story-check` — один grader

Code: `harness/evals/implementer-story/graders/story-check-green.md:3-5` · key lines: 4

```md
target: { source: file, path: .git/story-check.log }
pattern: '(?<![\s\S])(?=[\s\S]*^# Code story — demo 01: )(?=[\s\S]*^[^\n]*Kind: pr\b)(?=[\s\S]*^[^\n]*Language: ru\b)(?=(?:(?!^## )[\s\S])*^## 1\. Что было не так[ \t]*\r?$)(?=[\s\S]*^Code: )(?=[\s\S]*^- Что делает:)(?=[\s\S]*^- Почему здесь:)(?=[\s\S]*^- Без него:)(?=[\s\S]*^- Требование:)(?=[\s\S]*^- Риски и пробелы test-ов:)(?![\s\S]*Что нашёл review)(?=[\s\S]*^--- story-check ---\r?$[\s\S]*^in-branch: \.scratch/demo/stories/01-alpha\.md\r?$[\s\S]*\(branch demo/01\)[\s\S]*^EXIT=0\r?$)'
flags: m
```

- Что делает: один regex по log-у требует части из `story-pr.md` (заголовок, `Kind: pr`, `Language: ru`, первый шаг
  «Что было не так», фрагмент, пять полей, нет шага review), story этой ветки `demo/01` и `EXIT=0` после неё.
- Почему здесь: run получает долю пройденных grader-ов, порог — 0.8 (`scripts/eval-harness.mjs`). При пяти grader-ах
  один красный даёт 0.8, и сценарий проходит (review круг 1); при четырёх любой красный даёт 0.75.
- Без него: story с неверным фрагментом, story на `main` или story без поля проходили бы сценарий.
- Требование: [Готово, когда, п. 2](../issues/14-eval-story-pr-implementer-а.md#готово-когда)
- Риски и пробелы test-ов: contract test считает счёт run-а с красным `story-check` и проверяет, что он ниже порога.

## 4. Придуманную причину ловит модель, а не regex

Code: `harness/evals/implementer-story/graders/no-invented-reason.md:13-19` · key lines: 15, 18

```md
PASS if no field of a code step (`Что делает`, `Почему здесь`, `Без него`, `Требование`,
`Риски и пробелы test-ов`) states a reason, a motive or a fact about the project that neither the ticket text
above nor the code quoted in the story gives. Where a field would need such a reason, it says `не записано`.
What the ticket says and what follows from the quoted code itself (0 / 0 is NaN in JavaScript, `Math.floor`
drops the fraction) is not invented; a story that never needs a missing reason passes without `не записано`.
FAIL if any field gives an invented reason or fact instead of `не записано`: for example why the rounding is
down, which code calls `percent`, or which values the report never has.
```

- Что делает: `llm` grader читает копию story из HEAD и валит run, если поле code step-а называет причину или факт,
  которых нет ни в Ticket-е, ни в цитате кода.
- Почему здесь: прежний regex требовал `не записано` в поле; в proof run-е все три story были честны по структуре, но
  без `не записано`, а две из трёх придумали факты про отчёт. Regex не отличает записанную причину от догадки.
- Без него: сценарий не проверял бы правило `story-pr.md` «причину не придумывать».
- Требование: [Что делаем, п. 1](../issues/14-eval-story-pr-implementer-а.md#что-делаем)
- Риски и пробелы test-ов: суждение модели бесплатный test не проверяет, только текст grader-а и путь файла.

## 5. Учебный Ticket не даёт причины двум правилам, и у fixture-а есть origin

Code: `harness/evals/implementer-story/scaffold.sh:64-71` · key lines: 67, 68, 71

```sh
# An origin, a bare repository in .git, as demo-project.sh gives local-green: with pr-green-ci and no origin
# the preflight answers BLOCKED, and the implementer of the first paid run stopped at a local finish there
# and never reached the story (2026-11-16, three runs of 3, the log and the story copy missing).
git init -q --bare .git/demo-origin.git
git remote add origin "$(pwd -P)/.git/demo-origin.git"
git push -q origin main
git fetch -q origin
git remote set-head origin main
```

- Что делает: Ticket 01 просит округлять вниз и отдавать 0 при пустом `total`, не говоря почему; bare origin в
  `.git` и `worktree.base` `origin/main` дают implementer-у finish `pr-green-ci` без BLOCKED в preflight.
- Почему здесь: в первом платном run-е preflight ответил BLOCKED «no remote origin», implementer закончил локально и
  story не написал ни в одном из трёх run-ов.
- Без него: log-а нет, и сценарий проверял бы fixture, а не implementer-а.
- Требование: [Что делаем, п. 1](../issues/14-eval-story-pr-implementer-а.md#что-делаем)
- Риски и пробелы test-ов: `gh pr create` в sandbox-е падает, и PR нет; story оценивается по ветке.

## 6. Что сознательно не меняли

`harness/evals/lib/demo-project.sh` общий для всех сценариев; Ticket, `code_stories.pr`, origin и скрипт проверки
добавляет только scaffold этого сценария. `coverage.json` связывает сценарий с `agents/implementer.md`,
`story-pr.md` и `implementer-finish.md`.

## 7. Как проверено

- `npx vitest run --project contract test/contract/harness-evals*.test.ts` — exit 0: скрипт пишет `EXIT=0` на верной
  story, `EXIT=2` на неверном фрагменте и на story, которую обогнал код, `EXIT=1` на `main`, `EXIT=no-story` после
  удаления story; счёт run-а с одним красным `story-check` ниже порога. Mutant-ы скрипта и grader-ов убиты.
- Платные run-ы: диагностика 1 и 2 нашли BLOCKED без origin и выключенные hook-и; proof run дал 0.75 из-за regex
  `не записано`, после чего grader заменён на `llm`. Новый proof run — за владельцем.
- `pnpm lint`, `pnpm typecheck` — exit 0; gate fast — exit 0, `[gate] green (fast)`.
