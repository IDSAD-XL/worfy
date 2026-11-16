# Code story — worfy-code-stories 14: Eval-сценарий implementer-а: story PR на учебном Ticket-е проходит `story-check`

Kind: pr · Epic: worfy-code-stories · Ticket: 14 · PR: - · Language: ru

## 1. Что было не так

Story PR пишет implementer по шагу `ship-ticket` (Ticket 05), но ни один test не проверяет, что он это делает. Guard
в `land` ловит плохую story только на настоящем PR. Eval-сценария, где implementer пишет story на учебном Ticket-е,
не было: в `coverage.json` файл `story-pr.md` числился без сценария.

- Требование: [Что происходит](../issues/14-eval-story-pr-implementer-а.md#что-происходит)

## 2. Exit code `story-check` записывает hook, а не implementer

Code: `harness/evals/implementer-story/scaffold.sh:83-91` · key lines: 83, 88, 89

```sh
stories=$(git ls-tree -r --name-only HEAD -- .scratch/demo/stories) || exit 0
[ -n "$stories" ] || exit 0
log="$(git rev-parse --git-common-dir)/story-check.log" || exit 0
{
    printf 'stories: %s\n' $stories
    node '@STORY_CHECK@' $stories
    echo "EXIT=$?"
} >"$log" 2>&1
exit 0
```

- Что делает: после каждого commit-а, где HEAD содержит story учебного Epic-а, запускает `story-check` этой копии
  Harness-а и пишет список story, вывод и `EXIT=<код>` в `.git/story-check.log`. Commit без story log не трогает.
- Почему здесь: у `claude plugin eval` нет grader-а, который запускает команду; есть `regex`, `tool_used`,
  `file_exists`, `llm` по файлу или transcript-у. Свой запуск `story-check` implementer-ом — утверждение его отчёта,
  а не проверка. Hook ставит scaffold, потому что только он знает путь к `bin/story-check` копии.
- Без него: grader «`story-check` — exit 0» читал бы слова implementer-а, а не результат проверки.
- Требование: [Что делаем, п. 1](../issues/14-eval-story-pr-implementer-а.md#что-делаем)
- Риски и пробелы test-ов: hook проверяет HEAD последнего commit-а со story; если implementer работает в отдельном
  worktree, log всё равно в общей `.git`, но файл story — нет, и grader обязательных частей упадёт. На настоящем
  run-е hook не запускался: проверено только в contract test-е, без sandbox-а eval-а.

## 3. Учебный Ticket не даёт причины двум правилам

Code: `harness/evals/implementer-story/scaffold.sh:42-43` · key lines: 42, 43

```md
`src/alpha.mjs` экспортирует `percent(done, total)`: целый процент `done` от `total`, округлённый вниз
(`Math.floor`). Для `total`, равного 0, — 0.
```

- Что делает: просит округлять вниз и отдавать 0 при пустом `total`, не говоря почему.
- Почему здесь: grader обязательных частей ищет `не записано`; оно уместно, только если причину правда нигде не
  записали. Ticket `01-alpha` из общего fixture-а не содержит решения без причины, поэтому scaffold переписывает его.
- Без него: story могла бы без вымысла обойтись без `не записано`, и grader проверял бы не то.
- Требование: [Что делаем, п. 1](../issues/14-eval-story-pr-implementer-а.md#что-делаем)
- Риски и пробелы test-ов: grader видит только, что `не записано` есть где-то в story, а не в каком поле; придуманную
  причину рядом с ним он не поймает.

## 4. Сценарий привязан к файлам шага story

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

## 5. Что сознательно не меняли

`harness/evals/lib/demo-project.sh` общий для всех сценариев; Ticket, `code_stories.pr` и hook добавляет только
scaffold этого сценария. Платный run не запускали: только `--dry-run`, решение о платном run-е за владельцем.

## 6. Как проверено

- `npx vitest run --project contract test/contract/harness-evals-story.test.ts` — exit 0: hook пишет `EXIT=0` на
  верной story, `EXIT=2` на неверном фрагменте, `EXIT=1` на main; grader-ы проходят и падают на сломанных story.
- `pnpm eval:harness -- --case implementer-story --dry-run` — exit 0: один вызов `main`, бюджет 30 USD.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate fast — exit 0, `[gate] green (fast)`.
