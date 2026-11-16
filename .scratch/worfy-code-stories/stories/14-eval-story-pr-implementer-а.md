# Code story — worfy-code-stories 14: Eval-сценарий implementer-а: story PR на учебном Ticket-е проходит `story-check`

Kind: pr · Epic: worfy-code-stories · Ticket: 14 · PR: - · Language: ru

## 1. Что было не так

Story PR пишет implementer по шагу `ship-ticket` (Ticket 05), но ни один test не проверяет, что он это делает. Guard
в `land` ловит плохую story только на настоящем PR. Eval-сценария, где implementer пишет story на учебном Ticket-е,
не было: в `coverage.json` файл `story-pr.md` числился без сценария.

- Требование: [Что происходит](../issues/14-eval-story-pr-implementer-а.md#что-происходит)

## 2. Exit code `story-check` записывает hook, а не implementer

Code: `harness/evals/implementer-story/scaffold.sh:93-103` · key lines: 93, 96, 100, 102

```sh
in_branch=$(git diff --name-only --diff-filter=AM main...HEAD -- .scratch/demo/stories 2>/dev/null)
# Git gives a hook GIT_DIR (and in a linked worktree that is the worktree's own git folder): story-check
# finds the work tree from the current folder, the top of the tree that made the commit.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
{
    printf 'stories: %s\n' $stories
    [ -z "$in_branch" ] || printf 'in-branch: %s\n' $in_branch
    node '@STORY_CHECK@' $stories
    echo "EXIT=$?"
} >"$common/story-check.log" 2>&1
exit 0
```

- Что делает: после каждого commit-а, где HEAD содержит story учебного Epic-а, заново пишет `.git/story-check.log`:
  story, которые ветка добавила с `main` (`in-branch:`), вывод `story-check` этой копии Harness-а и `EXIT=<код>`.
  Перед запуском снимает `GIT_DIR`, который git даёт hook-у, чтобы `story-check` нашёл дерево по текущей папке и в
  связанном worktree.
- Почему здесь: у `claude plugin eval` нет grader-а, который запускает команду; есть `regex`, `tool_used`,
  `file_exists`, `llm` по файлу или transcript-у. Свой запуск `story-check` implementer-ом — утверждение его отчёта,
  а не проверка. Hook ставит scaffold, потому что только он знает путь к `bin/story-check` копии.
- Без него: grader «`story-check` — exit 0» читал бы слова implementer-а, а не результат проверки.
- Требование: [Что делаем, п. 1](../issues/14-eval-story-pr-implementer-а.md#что-делаем)
- Риски и пробелы test-ов: на настоящем run-е hook не запускался: проверено только в contract test-е, без
  sandbox-а eval-а. Ветка сравнивается с `main` учебного repo: другого base у fixture-а нет.

## 3. Красный `story-check` один валит сценарий

Code: `harness/evals/implementer-story/graders/story-check-green.md:3-5` · key lines: 4

```md
target: { source: file, path: .git/story-check.log }
pattern: '^in-branch: \.scratch/demo/stories/01-alpha\.md\r?$[\s\S]*^EXIT=0\r?$'
flags: m
```

- Что делает: один regex требует и story этой ветки по пути из `story-pr.md`, и `EXIT=0` после неё в том же log-е.
- Почему здесь: run получает долю пройденных grader-ов, порог — 0.8 (`scripts/eval-harness.mjs`). При пяти grader-ах
  красный `story-check` давал 4/5 = 0.8, и сценарий проходил (review круг 1). При четырёх любой красный даёт 0.75.
- Без него: story с неверным фрагментом или story, закоммиченная на `main`, проходили бы сценарий.
- Требование: [Готово, когда, п. 2](../issues/14-eval-story-pr-implementer-а.md#готово-когда)
- Риски и пробелы test-ов: пятый grader снова поднимет долю одного красного до 0.8; contract test считает счёт run-а
  и проверяет, что (n − 1) / n ниже порога.

## 4. Учебный Ticket не даёт причины двум правилам

Code: `harness/evals/implementer-story/scaffold.sh:43-44` · key lines: 43, 44

```md
`src/alpha.mjs` экспортирует `percent(done, total)`: целый процент `done` от `total`, округлённый вниз
(`Math.floor`). Для `total`, равного 0, — 0.
```

- Что делает: просит округлять вниз и отдавать 0 при пустом `total`, не говоря почему.
- Почему здесь: grader обязательных частей ищет `не записано` в поле «Почему здесь»; оно уместно, только если причину
  правда нигде не записали. Ticket `01-alpha` из общего fixture-а не содержит решения без причины, поэтому scaffold
  переписывает его.
- Без него: story могла бы без вымысла обойтись без `не записано`, и grader проверял бы не то.
- Требование: [Что делаем, п. 1](../issues/14-eval-story-pr-implementer-а.md#что-делаем)
- Риски и пробелы test-ов: implementer может честно написать в «Почему здесь» место из «Где в коде» и `не записано`
  только про округление; regex это пропускает, если обе части в значении поля. Придуманную причину в другом поле
  grader не ловит.

## 5. Сценарий привязан к файлам шага story

Code: `harness/evals/lib/coverage.json:9-9` · key lines: 9

```json
    "implementer-story": ["agents/implementer.md", "skills/ship-ticket/story-pr.md", "skills/ship-ticket/implementer-finish.md"],
```

- Что делает: `pnpm eval:harness -- --changed <base>` выбирает сценарий, когда меняется определение implementer-а,
  `story-pr.md` или `implementer-finish.md`.
- Почему здесь: карта `coverage.json` — единственное место, где `--changed` узнаёт сценарий по файлу правил.
- Без него: `scripts/eval-harness-coverage.mjs` назвал бы новый сценарий без файлов, а `story-pr.md` остался бы без
  сценария.
- Требование: [Что делаем, п. 2](../issues/14-eval-story-pr-implementer-а.md#что-делаем)
- Риски и пробелы test-ов: правка `agents/implementer.md` теперь выбирает два сценария; test-ы `harness-evals-run`,
  которым нужен один, меняют `implementer-report.md`.

## 6. Что сознательно не меняли

`harness/evals/lib/demo-project.sh` общий для всех сценариев; Ticket, `code_stories.pr` и hook добавляет только
scaffold этого сценария. Платный run не запускали: только `--dry-run`, решение о платном run-е за владельцем.

## 7. Как проверено

- `npx vitest run --project contract test/contract/harness-evals*.test.ts` — exit 0: hook пишет `EXIT=0` на верной
  story, `EXIT=2` на неверном фрагменте и на story, которую обогнал код, `EXIT=1` на `main`, нет `in-branch:` для
  story с `main`, `EXIT=0` в связанном worktree; счёт run-а с одним красным `story-check` ниже порога. Восемь mutant-ов
  (дописывание log-а, без `unset`, без сравнения с `main`, копия из рабочего файла, ослабленный regex) — все убиты.
- `pnpm eval:harness -- --case implementer-story --dry-run` — exit 0: один вызов `main`, бюджет 30 USD.
- `pnpm lint`, `pnpm typecheck` — exit 0; gate fast — exit 0, `[gate] green (fast)`.
