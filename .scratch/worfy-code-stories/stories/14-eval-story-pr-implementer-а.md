# Code story — worfy-code-stories 14: Eval-сценарий implementer-а: story PR на учебном Ticket-е проходит `story-check`

Kind: pr · Epic: worfy-code-stories · Ticket: 14 · PR: - · Language: ru

## 1. Что было не так

Story PR пишет implementer по шагу `ship-ticket` (Ticket 05), но ни один test не проверяет, что он это делает. Guard
в `land` ловит плохую story только на настоящем PR. Eval-сценария, где implementer пишет story на учебном Ticket-е,
не было: в `coverage.json` файл `story-pr.md` числился без сценария.

- Требование: [Что происходит](../issues/14-eval-story-pr-implementer-а.md#что-происходит)

## 2. Exit code `story-check` записывает скрипт fixture-а, а не implementer

Code: `harness/evals/implementer-story/scaffold.sh:118-126` · key lines: 120, 121, 124, 125

```sh
in_branch=$(git diff --name-only --diff-filter=AM main...HEAD -- .scratch/demo/stories 2>/dev/null)
{
    git show HEAD:.scratch/demo/stories/01-alpha.md 2>/dev/null
    echo '=== story-check ==='
    printf 'stories: %s\n' $stories
    [ -z "$in_branch" ] || printf 'in-branch: %s\n' $in_branch
    node '@STORY_CHECK@' $stories
    echo "EXIT=$?"
} >"$common/story-check.log" 2>&1
```

- Что делает: `.git/eval-finish.sh`, который сессия запускает последним шагом после отчёта implementer-а, заново пишет
  `.git/story-check.log`: story Ticket-а 01 из HEAD, строку `=== story-check ===`, story, которые ветка добавила с
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
pattern: '(?<![\s\S])(?=[\s\S]*^# Code story — demo 01: )(?=[\s\S]*^[^\n]*Kind: pr\b)(?=[\s\S]*^[^\n]*Language: ru\b)(?=(?:(?!^## )[\s\S])*^## 1\. Что было не так[ \t]*\r?$)(?=[\s\S]*^Code: )(?=[\s\S]*^- Что делает:)(?=[\s\S]*^- Почему здесь:)(?=[\s\S]*^- Без него:)(?=[\s\S]*^- Требование:)(?=[\s\S]*^- Риски и пробелы test-ов:)(?![\s\S]*Что нашёл review)(?=[\s\S]*^=== story-check ===\r?$[\s\S]*^in-branch: \.scratch/demo/stories/01-alpha\.md\r?$[\s\S]*\(branch demo/01\)[\s\S]*^EXIT=0\r?$)'
flags: m
```

- Что делает: один regex по log-у требует части из `story-pr.md` (заголовок, `Kind: pr`, `Language: ru`, первый шаг
  «Что было не так», фрагмент, пять полей, нет шага review), story этой ветки `demo/01` и `EXIT=0` после неё.
- Почему здесь: run получает долю пройденных grader-ов, порог — 0.8 (`scripts/eval-harness.mjs`). При пяти grader-ах
  один красный даёт 0.8, и сценарий проходит (review круг 1); при четырёх любой красный даёт 0.75.
- Без него: story с неверным фрагментом, story на `main` или story без поля проходили бы сценарий.
- Требование: [Готово, когда, п. 2](../issues/14-eval-story-pr-implementer-а.md#готово-когда)
- Риски и пробелы test-ов: contract test считает счёт run-а с красным `story-check` и проверяет, что он ниже порога.
  CLI режет frontmatter на первых трёх дефисах где угодно, поэтому разделитель в log-е — `===`; test режет
  frontmatter каждого `.md` в `harness/evals` regex-ом CLI.

## 4. Придуманную причину ловит модель, а не regex

Code: `harness/evals/implementer-story/graders/no-invented-reason.md:11-20` · key lines: 11, 14, 16, 18

```md
FAIL only for an invented fact: a statement in a field of a code step (`Что делает`, `Почему здесь`,
`Без него`, `Требование`, `Риски и пробелы test-ов`) that no part records. A fact is not invented when the
ticket or the project rules record it, or when it follows from the source files or the test files of the
input. A statement about test coverage (what the tests check, what they leave out) is judged against the test
files of the input. Naming the place because the ticket lists the file is recorded.
`не записано` is required only where a field states a reason for a rule that the ticket does not record; it
stands in place of that reason. A field that does not explain a rule needs no `не записано`.
Bad, from earlier runs: «Почему здесь: отчёт вызывает `percent`; это единственное место» — no part has code of a
report or anything that calls `percent`, so who calls it is invented.
PASS when no field holds an invented fact.
```

- Что делает: `llm` grader валит run только за придуманный факт: то, чего нет ни в Ticket-е, ни в правилах, ни в
  исходных файлах и test-ах из входа. Утверждения о покрытии сверяет с test-ами; `не записано` требует только там,
  где поле объясняет правило, причину которого Ticket не записал.
- Почему здесь: прежний regex требовал `не записано` в поле, а regex не отличает записанную причину от догадки.
  В run-е head-а b67409e1d все три story следовали правилу `story-pr.md`, а судья ставил FAIL 9 из 9: прежний
  критерий не видел test-ов, и «отрицательные `done` test-ом не покрыты» в «Рисках» был для него вымыслом.
- Без него: сценарий не проверял бы правило `story-pr.md` «причину не придумывать» или валил бы честные story.
- Требование: [Что делаем, п. 1](../issues/14-eval-story-pr-implementer-а.md#что-делаем)
- Риски и пробелы test-ов: суждение модели бесплатный test не проверяет, только текст критерия и вход судьи.

## 5. Вход судьи — всё, на что story может сослаться

Code: `harness/evals/implementer-story/scaffold.sh:127-138` · key lines: 133, 134, 135, 138

```sh
fence='````'
part() { # $1 = the heading, $2 = the text
    printf '# %s\n\n%s\n%s\n%s\n\n' "$1" "$fence" "$2" "$fence"
}
{
    part 'The ticket .scratch/demo/issues/01-alpha.md as HEAD has it' "$(git show HEAD:.scratch/demo/issues/01-alpha.md 2>/dev/null)"
    part 'The project rules (rules.md of the demo profile)' "$(cat "$common/demo-rules.md" 2>/dev/null)"
    for file in $(git ls-tree -r --name-only HEAD -- src test | grep '\.mjs$'); do
        part "The file $file as HEAD has it" "$(git show "HEAD:$file")"
    done
    part 'The Code story .scratch/demo/stories/01-alpha.md as HEAD has it' "$(git show HEAD:.scratch/demo/stories/01-alpha.md 2>/dev/null)"
} >"$common/story-check/judge-input.md"
```

- Что делает: `.git/eval-finish.sh` пишет `.git/story-check/judge-input.md`: Ticket 01, правила учебного проекта,
  `src/*.mjs` и `test/*.mjs` — всё из HEAD — и story последней, каждую часть в fence из четырёх backtick-ов.
- Почему здесь: `llm` grader читает ровно один файл (`focus`); вход собирает тот же скрипт, что пишет log, после
  отчёта implementer-а. Правила scaffold заранее копирует в `.git/demo-rules.md`: в сессии путь к profile неизвестен.
- Без него: судья видел бы только story и критерий и считал бы вымыслом всё, что взято из test-ов.
- Требование: [Что делаем, п. 1](../issues/14-eval-story-pr-implementer-а.md#что-делаем)
- Риски и пробелы test-ов: contract test сравнивает файл целиком с частями из HEAD; незакоммиченная правка в
  него не попадает.

## 6. Правило для «Почему здесь» в шаге story

Code: `harness/skills/ship-ticket/story-pr.md:35-40` · key lines: 35, 37, 38

```md
- `Why here` holds only what the ticket, the project rules or the code record. When the ticket lists the file in
  its section of files (`tickets.trail_section`), say just that: the place is named in the ticket
  (`tickets.trail_section`), and the reason for the rule is `not recorded`. Never infer who calls the code, what
  else uses it, or a motive.
  Bad: `Why here: the only place the invoice formats dates; the rest of the code calls formatDate`.
  Good: `Why here: the ticket names src/date.mjs among its files; why the format is ISO is not recorded`.
```

- Что делает: разрешает в «Почему здесь» только записанное в Ticket-е, правилах проекта или коде; если Ticket
  перечисляет файл, поле говорит это, а причину правила — `not recorded`; запрещает выводить, кто вызывает код, что
  ещё его использует, и мотив. Пример — на нейтральной функции `formatDate`, не на `percent` сценария.
- Почему здесь: платный run head-а b6020ada0 дал FAIL судьи во всех трёх run-ах; во всех трёх story «Почему здесь»
  утверждало, что отчёт вызывает `percent` и это единственное место, а кода отчёта в repo нет. Общее правило
  `not recorded` в `story-pr.md` уже было, но на это поле не действовало.
- Без него: сценарий оставался бы красным (0.75), а story настоящих PR несли бы придуманные мотивы.
- Требование: [Что делаем, п. 4](../issues/14-eval-story-pr-implementer-а.md#что-делаем)
- Риски и пробелы test-ов: `agents-text.test.sh` проверяет только наличие текста правила; действует ли оно на
  модель, покажет следующий платный run.

## 7. Учебный Ticket не даёт причины двум правилам, и у fixture-а есть origin

Code: `harness/evals/implementer-story/scaffold.sh:65-72` · key lines: 68, 69, 72

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

## 8. Что сознательно не меняли

`harness/evals/lib/demo-project.sh` общий для всех сценариев; Ticket, `code_stories.pr`, origin и скрипт проверки
добавляет только scaffold этого сценария. `coverage.json` связывает сценарий с `agents/implementer.md`,
`story-pr.md` и `implementer-finish.md`.

## 9. Как проверено

- `npx vitest run --project contract test/contract/harness-evals*.test.ts` — exit 0: скрипт пишет `EXIT=0` на верной
  story, `EXIT=2` на неверном фрагменте и на story, которую обогнал код, `EXIT=1` на `main`, `EXIT=no-story` после
  удаления story; счёт run-а с одним красным `story-check` ниже порога. Mutant-ы скрипта и grader-ов убиты.
- Платные run-ы: диагностика 1 и 2 нашли BLOCKED без origin и выключенные hook-и; proof run дал 0.75 из-за regex
  `не записано`, после чего grader заменён на `llm`; run head-а b6020ada0 дал 0.75 из-за придуманного «Почему
  здесь», после чего добавлено правило в `story-pr.md`; run head-а b67409e1d — честные story и FAIL судьи 9 из 9,
  после чего судья получил вход со всеми частями и новый критерий. Новый run — за владельцем.
- `HOME=$(mktemp -d) bash harness/bin/tests/agents-text.test.sh` — exit 0, проверяет текст нового правила.
- `pnpm lint`, `pnpm typecheck` — exit 0; gate fast — exit 0, `[gate] green (fast)`.
