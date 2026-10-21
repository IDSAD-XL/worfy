# 62 — Gate: при переименовании файла старый путь теряется, и workspace, откуда файл ушёл, не проверяется

Type: bug
Status: open
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

Заполняется при закрытии.
