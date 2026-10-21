# 62 — Gate: при переименовании файла старый путь теряется, и workspace, откуда файл ушёл, не проверяется

Type: bug
Status: done 2026-10-21T19:33Z
PR: #702
Blocked by: —
Source: ревью PR #690 (worfy-harness 29), линза корректности, 2026-10-21 — находка вне diff-а; в самом PR #690
та же ошибка в `scripts/eval-harness.mjs` исправлена флагом `--no-renames`.

## Что происходит

`harness/hooks/gate.mjs`, функция `changedPaths()` (около `:415-423`), сужает scope gate по изменённым файлам.
`git status --porcelain` и `git diff --name-only <merge-base>...HEAD` по умолчанию ищут переименования: строка
`R  old -> new` обрезается до `new`, а `diff --name-only` печатает только новый путь. Если файл перенесён из
workspace A в workspace B, в scope попадает только B. Test-ы A, у которого файл пропал, gate fast не гоняет.
Пути в кавычках (`core.quotePath=false` не снимает кавычки у имён со спецсимволами) очищаются только от кавычек,
без раскодирования escape-последовательностей.

## Что делаем

1. Красный test в test-е gate: перенос файла между двумя workspace (staged и закоммиченный) — оба в scope.
2. `--no-renames` в обоих вызовах git; `-z` с разбором по NUL вместо снятия кавычек. Так же, как в PR #690.

## Готово, когда

- [ ] Test с переносом красный на main, зелёный с правкой; мутант без `--no-renames` — красный.
- [ ] Test-ы gate по файлам, `plugin-neutral.test.sh`, оба guard test-а — exit 0.

## Где в коде

- `harness/hooks/gate.mjs` — `changedPaths()`.

## Риски

- Платформенный PR (`harness/hooks`): после Mac gate нужен Windows verdict.

## Итог

PR [#702](https://github.com/IDSAD-XL/worfy/pull/702), squash 5b0d4124. Платформенный PR; check/windows с PC — 4 .sh test-а, 0 failed; gate full зелёный (один известный flaky e2e browser-layer.spec:627, отдельно 9/9).
- **Правка:** `changedPaths()` в `harness/hooks/gate.mjs` — `git status --porcelain --no-renames -z` и `git diff --name-only --no-renames -z`, разбор по NUL; перенос файла между workspace ставит в scope оба; пути с пробелом и кавычкой — настоящие. `sizeWarnings()` читает переименования с `-z` — без ложного «(0 → N)» для длинного файла с именем в кавычках.
- **Test-ы:** новый `harness/hooks/tests/gate-scope.test.sh` (7 случаев: перенос staged и закоммиченный, пробел, кавычка — пропуск на Windows с причиной, неотслеживаемый файл); красный на main (3 из 5), мутанты без `--no-renames` и без неотслеживаемых — красные; fake `npm` первым в PATH и `npm_config_cache` во временной папке test-а. Случай в `gate-file-size.test.sh` для переименования в имя с кавычкой — красный до правки. Сообщения в `gate-verdict.test.sh` — новая команда git.
- **Ревью:** круг 1 (high) — correctness и tests PASS, только low; круг 2 их закрыл.
- **Follow-up:** Ticket 64 — `gate-resolve.mjs` получает пути построчно и обрезает их.
