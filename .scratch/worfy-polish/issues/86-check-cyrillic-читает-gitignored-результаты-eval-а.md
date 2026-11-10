# 86 — `check-cyrillic` читает gitignored-результаты eval-а, и lint краснеет в worktree

Type: bug
Status: done 2026-11-10T02:10Z
PR: #1756
Blocked by: —
Source: находка Orchestrator-а 2026-11-09: после платного eval-а в worktree Ticket-а gate fast в этом worktree стал
красным на `pnpm lint`. Строки перечитаны по main `c69ffd43b`.

## Что происходит

`node scripts/eval-harness.mjs` пишет результаты каждого вызова в `harness/evals/results/<время>-<call>/` внутри
текущего checkout-а: `report.html`, `aggregate-result.json`, transcript-ы run-ов. Папка в `.gitignore`, в git она не
попадает. Но `scripts/check-cyrillic.mjs` (шаг `pnpm lint`) обходит `src/`, `scripts/`, `test/` и `harness/` через
`readdirSync`, без учёта `.gitignore`, и проверяет файлы `.html` построчно. В `report.html` есть русский текст
prompt-ов case-ов, поэтому lint падает на каждой его строке с кириллицей. Gate fast в этом worktree краснеет, хотя в
diff-е PR кириллицы нет; implementer тратит время на чужую красноту или удаляет результаты eval-а, которые нужны
для «Итог».

`scripts/check-personal.mjs` того же `pnpm lint` уже берёт файлы из `git ls-files` и этой проблемы не имеет.

## Что делаем

Рекомендация — **пропускать gitignored-пути в `check-cyrillic`**: проверка о коде репозитория, а gitignored-файл в
репозиторий не попадёт. Список файлов — `git ls-files --cached --others --exclude-standard` под четырьмя папками (новые
ещё не добавленные файлы проверяются, gitignored — нет), как в `check-personal.mjs`. Вне git work tree (`--root`
на папку без git) — прежний обход `readdirSync`.

Альтернатива — писать результаты eval-а вне worktree (например, рядом с копией git для run-ов,
`~/Library/Caches/worfy-eval/` на macOS). Она чинит только этот случай: любой другой gitignored-файл под `harness/`
или `scripts/` снова покрасит lint. Не выбрана.

## Готово, когда

- [ ] Test: gitignored `.html` с кириллицей под `harness/evals/results/` — `check-cyrillic` exit 0; тот же файл вне
      `.gitignore` (новый, не добавленный в git) — finding и exit 1.
  - evidence: gate pass · `gate fast` exit 0 (test/unit/check-cyrillic.test.ts, describe the command: which files it reads) · mac - · e30af911eb53301666afe1901333254b94e9982a
- [ ] Test: `--root` на папку без git — прежний обход, finding-и те же, что до правки.
  - evidence: gate pass · `gate fast` exit 0 (test/unit/check-cyrillic.test.ts, outside a git work tree case) · mac - · e30af911eb53301666afe1901333254b94e9982a
- [ ] Ручная проверка в своём worktree: положить `harness/evals/results/x/report.html` с кириллицей — `pnpm lint`
      exit 0; команда и exit code в «Итог».
  - evidence: test-run pass · `pnpm lint` exit 0 with an ignored harness/evals/results/x/report.html holding Cyrillic; old script exit 1 on it · mac - · 6db5c4b4d
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.
  - evidence: gate pass · `gate fast` exit 0 (lint, typecheck, test) · mac - · e30af911eb53301666afe1901333254b94e9982a
  - evidence: gate pass · gate fast exit 0 after rebase onto origin/main 922e661d9 (lint, typecheck, test) · mac - · a252b41bde92dde12652861c7285f9a156979c47

## Где в коде

- `scripts/check-cyrillic.mjs:280–292` — `walk`, обход `readdirSync` без `.gitignore` (пропускает только
  `node_modules`); :298–299 — обход четырёх папок в `main`; :12 — `.html` в списке проверяемых; :270–274 — проверка
  построчно.
- `scripts/eval-harness.mjs:391` — `outputDir = join(EVALS, 'results', …)`; :79 — `EVALS`; :412 — путь `report.html`
  в выводе.
- `.gitignore:13–14` — `harness/evals/results/`.
- `scripts/check-personal.mjs:283` — список файлов из `git ls-files` (образец).
- `package.json:17` — `lint`, в нём `node scripts/check-cyrillic.mjs`.

## Вне скоупа

- Правила, какие файлы считаются кодом (`kindOf`), и правило ESLint `noCyrillic`.

## Итог

- Выбрана рекомендация ticket-а: `scripts/check-cyrillic.mjs` в git work tree берёт файлы четырёх папок из
  `git ls-files -z --cached --others --exclude-standard -- src scripts test harness` (функция `codeFiles`). Gitignored
  файл — отчёт eval-а под `harness/evals/results/`, результат `pnpm eval:outcome` под `scripts/eval-outcome/results/` —
  не читается; новый,
  ещё не добавленный файл читается; tracked-файл под ignored-папкой (добавлен `git add -f`) читается. Tracked-файл,
  удалённый с диска, symlink и submodule пропускаются (`lstatSync(...).isFile()`), как в прежнем обходе. Вне git work
  tree (git отказал) — прежний обход `readdirSync`.
- `-z`: пути без кавычек и с `/` на любой ОС; `join(root, rel)` на Windows даёт обратные слэши, `relPath` их
  нормализует, как раньше.
- Тесты — `test/unit/check-cyrillic.test.ts`, describe «the command: which files it reads»: пять случаев (ignored
  отчёт — exit 0; тот же файл без `.gitignore` — finding и exit 1; tracked под ignored-папкой — finding; удалённый
  tracked-файл — exit 0 без ошибки; папка без git с тем же `.gitignore` — finding-и прежнего обхода). Git в тестах —
  без глобального конфига машины (`GIT_CONFIG_GLOBAL` на пустой файл, `GIT_CONFIG_NOSYSTEM=1`).
- Mutation testing в отдельной копии: убрать `--exclude-standard`, `--others`, `--cached`, фильтр `isFile` или
  возврат к обходу вне git — каждый mutant краснит свой test.
- Ручная проверка в worktree ticket-а: `harness/evals/results/x/report.html` с кириллицей (`git check-ignore -v` —
  `.gitignore:14`); `node scripts/check-cyrillic.mjs` версии `origin/main` — exit 1 с finding-ом на `report.html:1`;
  новая версия — exit 0; `pnpm lint` — exit 0. Файл удалён после проверки.
- Другие `scripts/check-*.mjs`: `check-lessons.mjs` и `check-feature-docs.mjs` читают через `readdirSync` только
  верхний уровень `docs/lessons/` и `docs/features/`, туда ничего gitignored не пишется; `check-handoff.mjs` читает один
  `HANDOFF.md`; `check-fuses.mjs` — собранный `.app`, не часть `pnpm lint`; `check-personal.mjs` уже на
  `git ls-files`. Та же проблема остаётся у `eslint .` (первый шаг `pnpm lint`): flat config ESLint не читает
  `.gitignore`, а `ignores` в `eslint.config.js:84` не называют `harness/evals/results/` и `scripts/eval-outcome/results/`.
  Отчёт eval-а (`.html`, `.json`) ESLint не читает, но любой `.js`/`.ts`/`.mjs` в этих папках прочтёт. Вне скоупа
  ticket-а, не правилось.
