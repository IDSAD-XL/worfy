# 179 — guard: glob и `/` в конце источника `cp`/`mv`; общий helper папки Ticket-ов и base branch для guard и `land`

Type: task
Status: open
Blocked by: None — can start immediately
Source: решение владельца 2026-11-28 (Q4 «ок») по долгу review round 3 PR #2386 (worfy-harness-guarantees 03, guard:
путь проверки — только по trail-у) и по замечанию review round 1 того же PR о дубле разрешения папки Ticket-ов.

Кто: агент. Глубина review — `medium`; reviewer делает mutation testing новых правил. Платформенный PR (ADR-0056, пункт
2): hook Harness и скрипт `harness/bin/land`, shell test-ы идут и в Git Bash; verdict Windows — CI job `check/windows`.

## Что происходит

- Guard (`harness/hooks/guard.mjs`, функция `shellTargets`, строка 1099; комментарий над ней — строки 1088-1098) читает
  shell-команду Subagent-а лексически. Папку-источник `cp -r`/`-R`/`-a`, `mv` и `rsync` он проверяет по её буквальному
  имени. Два случая проходят мимо, хотя пишут папку над путём проверки:
  - источник-glob: `cp -r tmpl/* .github/`, `cp -r tmpl/* .github`, `mv tmpl/* .github/` (в `tmpl` лежит `workflows/`,
    значит пишется `.github/workflows`);
  - источник `cp` с `/` в конце: `cp -R tmpl/ .github`, `cp -R tmpl/ .github/`, `cp -r tmpl/ .github`. BSD `cp` на
    macOS копирует содержимое такой папки, как `rsync` (review round 3 воспроизвёл запись `.github/workflows/evil.yml`).
  На head round 2 (1fbd3a296) все шесть команд получали отказ. При merge такой PR ловит `land` (он смотрит diff PR), и
  spec принимает лексические обходы («Риски», «Лексический guard обходится»), поэтому в PR #2386 это осталось долгом.
- Test на rebase с backend-ом apply (`rebase-apply/head-name`, `guard.mjs:1303`) отсутствует: проверен только
  `rebase-merge`. Мутант, который убирает `rebase-apply/head-name`, проходит все test-ы.
- Guard и `land` по отдельности решают, где папка Ticket-ов и какая base branch:
  - guard: `ticketsPlace` (`guard.mjs:1322`), `baseOf` (`:1334`), `trailOf` (`:1347`);
  - `land`: `profileTicketsRoot` (`harness/bin/land:1473`), разрешение base branch в `land --check`
    (`harness/bin/land:1517-1525`), папка Ticket-ов через `bin/ticket root`.
  Правила уже расходятся: при `worktree.base` без `/` guard читает trail на локальной ветке, а `land` отказывает.

## Что строить

1. В `shellTargets` считать записью в саму цель источник-glob (слово с `*`, `?` или `[`, которое guard не раскрывает) и
   источник `cp` с `/` в конце: проверка папки над путём проверки идёт по цели, как уже для `rsync src/` и `-T`. Обычный
   glob файлов (`mv *.md .github/`) остаётся разрешён, если цель — не путь проверки и не папка над ним.
2. Test на rebase с backend-ом apply: остановленный на конфликте `git rebase --apply` — путь, который trail называет,
   разрешён; путь вне trail-а — обычный отказ.
3. Общий helper в `harness/lib/` (папка Ticket-ов внутри репозитория и base branch по Profile-у): guard и `land` зовут
   его, их копии удаляются. Поведение `land` не меняется; поведение guard при `worktree.base` без `/` — как у `land`
   (вызов проходит: сбой guard открывает проход, страховка — `land`).
4. Комментарий над `shellTargets` и feature page (`docs/features/skills-agents-and-hooks.md`, абзац о том, что guard не
   раскрывает glob) — по новому поведению. Новый файл `harness/lib/` — в `harness/evals/lib/coverage.json`.

## Где в коде

- `harness/hooks/guard.mjs`
- `harness/lib/` — новый helper
- `harness/bin/land`
- `harness/hooks/tests/guard-verification.test.sh`
- `harness/bin/tests/land-verification.test.sh`
- `harness/evals/lib/coverage.json`
- `docs/features/skills-agents-and-hooks.md`
- `.scratch/worfy-polish/issues/179-guard-glob-и-слэш-в-источнике-cp-общий-helper-с-land.md`
- `.scratch/worfy-polish/stories/179-guard-glob-и-слэш-в-источнике-cp-общий-helper-с-land.md`

## Готово, когда

- [ ] `cp -r tmpl/* .github/`, `cp -r tmpl/* .github`, `mv tmpl/* .github/`, `cp -R tmpl/ .github`, `cp -R tmpl/ .github/`
  и `cp -r tmpl/ .github` из Subagent-а без trail-а получают отказ; `mv *.md docs/` и `mv notes.md tools/` проходят.
  Test на каждый случай, красный до правки.
- [ ] Test на остановленный `git rebase --apply`: путь из trail-а разрешён, путь вне trail-а — отказ «does not name it».
- [ ] Guard и `land` берут папку Ticket-ов и base branch из одного helper-а в `harness/lib/`; копий в `guard.mjs` и
  `harness/bin/land` нет; `land.test.sh`, `land-verification.test.sh`, `guard-verification.test.sh` зелёные.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR, Windows job-ы guard и `land` прошли.
