# 86 — `check-cyrillic` читает gitignored-результаты eval-а, и lint краснеет в worktree

Type: bug
Status: open
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
- [ ] Test: `--root` на папку без git — прежний обход, finding-и те же, что до правки.
- [ ] Ручная проверка в своём worktree: положить `harness/evals/results/x/report.html` с кириллицей — `pnpm lint`
      exit 0; команда и exit code в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный.

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
