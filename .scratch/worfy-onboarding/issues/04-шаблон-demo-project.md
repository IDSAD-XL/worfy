# 04 — Шаблон Demo project: todo CLI, Epic, Ticket и черновик Profile `worfy-demo`

Type: task
Status: open
Blocked by: —
Source: решения владельца 2026-10-26, пункт 5 (содержимое demo, Ticket «add `done <n>`», крайний случай только в полной проверке ревьюера); [spec.md](../spec.md), «Как устроено», «Demo project»; «Решено без владельца», Р1, Р13, Р14 (решено без владельца, подтверждено владельцем 2026-10-26)

## Что происходит

- Demo project worfy создаёт сам (Ticket 05). Содержимое нужно держать в коде worfy, а не
  ресурсом сборки: `electron-builder.yml` (`extraResources`, `:29-35`) этот Epic не меняет.
- Черновик Profile для `bin/project-connect` — один JSON `{ profile, rules, gate }`
  (`harness/profiles/draft.schema.json`). Обязательные поля profile: `schema`, `name`, `title`, `mode`,
  `language`, `attribution`, `layout`, `stack`, `commands`, `parallel`, `worktree`, `tickets`,
  `workflow`, `numbering`, `deploy`, `github`, `docs`, `lessons`, `mcp`, `review`. Запись gate registry:
  `key`, `match`, `profile`, `pm`, `root.fast`, `root.full`, `workspace`.
- `bin/project-connect --check` проверяет черновик, ничего не записывая (шапка скрипта, `:20`).
- Без `workflow.pipeline` Project получает Pipeline по умолчанию с Stage CI
  (`src/shared/workflow/pipeline.ts:76-78`); CI проходит только с открытым PR (`:237-238`), а у demo PR
  нет.

## Что делаем

1. Новый модуль `src/main/getting-started/demo-template.ts`: функция
   `demoTemplate({ root, profileName })` возвращает файлы (путь → текст) и черновик Profile. Без
   ввода-вывода.
2. Файлы:
   - `package.json` без `dependencies`, `"type": "module"`, `scripts.test` — `node --test`;
   - `src/todo.js` — список задач в `todo.json` текущей папки: `add <text>`, `list`; `bin/todo.js` —
     разбор аргументов;
   - `test/fast/todo.test.js` — add и list;
   - `test/full/cli.test.js` — все команды через запуск CLI, в том числе `done <n>`: отмечает задачу;
     уже сделанная задача — сообщение и код 1; номер вне списка — сообщение и код 1;
   - `README.md` — две строки, что это;
   - `.scratch/todo/spec.md` — Epic `todo` в формате worfy (Status/Source, «## Цель»);
   - `.scratch/todo/issues/01-done-command.md` — Ticket «add `done <n>` that marks a task done»: шапка
     `Type:` / `Status: open` / `Blocked by: —` / `Source:`, разделы как у Ticket-ов worfy. О крайнем
     случае Ticket молчит (риск 1 spec-а);
   - `.gitignore` — `todo.json`, `.claude/worktrees/`.
3. Черновик Profile `worfy-demo`: Full mode, `workflow.finish` `local-green`, `github.account` null,
   `workflow.pipeline` — Queued, Implementing, Agent review, Gate & merge, Done; `tickets` — `.scratch`;
   язык команды и документов — английский; gate registry: `root.fast` — `node --test test/fast/`,
   `root.full` — `node --test`; `pm` null. Остальные поля — минимальные значения, которые принимает
   схема; в «Итог» — таблица полей и почему так.
4. Строки с переводом строки только `\n`; test-ы demo не зависят от `\r\n` (git на Windows с
   `core.autocrlf`).

## Готово, когда

- [ ] Unit test: шаблон, записанный во временную папку, — `node --test test/fast/` exit 0;
      `node --test` exit не 0, и падают только test-ы `done` (до Ticket-а demo команды `done` нет).
- [ ] Unit test: шаблон с дописанной эталонной `done` (fixture в test-е) — `node --test` exit 0; эталон
      без проверки «уже сделана» — падает ровно test крайнего случая.
- [ ] Contract test: черновик проходит настоящий `harness/bin/project-connect --check` во временной
      `HARNESS_HOME` (exit 0).
- [ ] `bin/epic-status` над записанным шаблоном видит Epic `todo` с одним открытым Ticket-ом.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; gate full — exit 0 и строка
      `[gate] green (full)` (оркестратор перед merge).

## Тесты

- Unit `test/unit/demo-template.test.ts` (новый): запись во временную папку, запуск `node --test` с
  `process.execPath`, проверка `--check` и `epic-status` из `harness/bin`.
- Сначала падающий: test импорта `demoTemplate` — модуля нет.

## Где в коде

- `src/main/getting-started/demo-template.ts` (новый)
- `test/unit/demo-template.test.ts` (новый)

Только читать: `harness/profiles/draft.schema.json`, `harness/profiles/README.md`,
`harness/bin/project-connect`, `src/shared/workflow/pipeline.ts`, `src/main/projects/connect.ts`
(`applyChoices`, `:423-439`).

## Итог

Шаблон — `src/main/getting-started/demo-template.ts`, `demoTemplate({ root, profileName })` →
`{ files, draft }`; пути `files` — с `/`, переводы строк — только `\n`. Test-ы:
`test/unit/demo-template.test.ts` (файлы и черновик как значения) и
`test/contract/demo-template.test.ts` (запуск `node --test`, `project-connect --check`, `epic-status`):
запуски процессов ушли в contract test, у которого предел 15 с, а не 5 с, как у unit.

Отступление от «Что делаем», пункт 3: gate registry запускает не команды, а script-ы `package.json`
через `<pm> run <script>` (`harness/hooks/gate.mjs`, `runScript`; `pm` null → `npm`). Поэтому
`root.fast` — `["test:fast"]`, `root.full` — `["test"]`, а сами команды — в `package.json`:
`test:fast` — `node --test test/fast/*.test.js`, `test` — `node --test`. Форма `node --test test/fast/`
не годится: Node 24 принимает папку за файл test-а и падает («test failed»); glob Node раскрывает сам
и там, где shell этого не делает (cmd.exe на Windows).

| Поле | Значение | Почему |
| --- | --- | --- |
| `schema`, `name`, `title` | `2`, `profileName`, `worfy demo` | имя приходит от Ticket-а 05 (Р14: `worfy-demo`) |
| `mode`, `workflow.folder` | `full`, `null` | пункт 5: Full mode, файлы workflow в репозитории demo |
| `language` | `{ team: en, docs: en }` | язык команды и документов — английский; `reports` новый Profile не пишет (README Profile-ей) |
| `attribution` | `on` | значение Full mode по умолчанию |
| `layout`, `stack` | один пакет, `packages: ["."]`, `repos: null` | факты шаблона |
| `commands.test`, `verify` | `npm run test:fast` | проверка исполнителя — только `test/fast/` (риск 1) |
| `commands.test_one` | `node --test <file>` | прицельный запуск одного файла |
| остальные `commands` | `null`, `requires: []` | установки, lint, сборки нет |
| `parallel` | `worktrees` | как у worfy: исполнитель и ревьюер в своих worktree |
| `worktree.root` | `<root>/.claude/worktrees/` | как `applyChoices`; только там `EnterWorktree` пускает правки |
| `worktree.base` | `main` | без `origin` preflight берёт локальную ветку |
| `worktree.implementer` / `reviewer` | `git worktree add …` от `main`, путь в одинарных кавычках с `/` | путь с пробелом или `'` (Windows, Git Bash) не ломает команду |
| `tickets` | `.scratch/`, `.scratch/<epic>/issues/NN-*.md`, `## Where in code`, `## Done when`, `<epic>/<NN>` | Р14: ветка `todo/01`; разделы — как в Ticket-е demo |
| `workflow.ticket_skill`, `merge` | `ship-ticket`, `orchestrator` | шаг 4 отправляет `/worfy:ship-ticket todo 01` |
| `workflow.finish` | `local-green` | без GitHub |
| `workflow.pipeline` | Queued, Implementing, Agent review, Gate & merge, Done | Р1: без CI и Closing |
| `numbering`, `deploy`, `docs` | `null` | ADR, миграций, деплоя, файла состояния нет |
| `github.account` | `null` | без GitHub |
| `lessons` | `profile` | уроки не попадают в репозиторий demo и уходят вместе с Profile при удалении |
| `mcp.allowed` | `["worfy-canvas"]` | qmd для demo не подключается (Р13) |
| `review` | `correctness`, `tests` | две линзы, которые ловят крайний случай `done` |
| gate | `key` и `profile` = `profileName`, `match` = `root`, `pm: null`, `workspace: {}` | один репозиторий, один пакет |

Для Ticket-а 05: `worktree.base` и команды worktree называют ветку `main` — `git init` demo должен
создать именно её (`git init -b main`), иначе preflight и `git worktree add` не найдут базу.
