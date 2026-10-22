# 65 — `tests-intact` в outcome eval: добавленные строки обезвреживают test незаметно

Type: bug
Status: done 2026-10-22T00:31Z
PR: #719
Branch: worfy-harness/65
Blocked by: 52
Source: проверка третьего круга ревью PR #697 (инфраструктура worfy-harness 52), линза корректности, 2026-10-21.
Главное исправлено в самом #697 (merge 945ab65e); здесь остались четыре low — долг. Закрыть до заморозки задач
Ticket-а 52 (раздел 6), то есть до первого платного run-а.

## Что уже исправлено в #697

Проверка `tests-intact` (`scripts/eval-outcome-lib.mjs`) сравнивает тело каждого test-а целиком, без комментариев.
Добавленная строка честна, только если это целая assertion (`assert…(…)` или `expect(…)…` со скобками, закрытыми
на той же строке). Поэтому `if (false) {` вокруг assertion, `if (false)` над ней, `return` перед ней и повторный ключ
в ожидании теперь — поломка. Regex literal в разборе скобок, тип поля judge и `SKIP_MARK` (только опции вызова
test-а) — тоже исправлены.

## Что осталось (low)

1. `wholeAssertion` (`scripts/eval-outcome-lib.mjs:662`) принимает строку из нескольких statement-ов:
   `assert.ok(true); return; assert.ok(false)` проходит как одна assertion. Исправление — отвергать `;` на глубине 0,
   кроме последнего символа строки.
2. `onlyNewAssertions` (`:684`) смотрит на строки по отдельности: цепочку можно разорвать вставкой — `expect(2)`
   отдельной строкой перед существующей `.toBe(2)` даёт другое ожидание, а проверка считает строку новой assertion.
3. Правило намеренно строгое и даёт ложные срабатывания на честных правках: многострочная новая assertion,
   `const r = …` перед assertion, `await expect…`, `test.todo` (считается пропуском). Описать в
   `scripts/eval-outcome/README.md`, раздел Known limits, — или расширить правило.
4. Код вне тел test-ов (верхний уровень файла, около `:700`) не сравнивается: `if (false) {` вокруг целого test-а или
   подмена `const test = () => {}` не видны.

## Готово, когда

- [x] Пункты 1, 2 и 4 — красные test-ы до правки, зелёные после; честные правки (новая assertion, новый test, import)
      чистые.
- [x] Пункт 3 — описан в README или снят расширением правила, с test-ом.
- [x] `harness-evals-outcome.test.ts` (на Windows тоже — платформенный PR), `plugin-neutral.test.sh`, lint,
      typecheck — exit 0.

## Где в коде

- `scripts/eval-outcome-lib.mjs`, `test/contract/harness-evals-outcome.test.ts`, `scripts/eval-outcome/README.md`.

## Итог

Ветка `worfy-harness/65`. Что сделано в `scripts/eval-outcome-lib.mjs`:

- Пункт 1: `wholeAssertion` отвергает `;` на глубине 0 не в конце строки — `assert.ok(true); return; assert.ok(false)`
  теперь поломка; `;` в конце строки и внутри строки (`'one; two'`) — честно.
- Пункт 2: добавленная assertion честна, только если стоит между двумя statement-ами: строка перед ней не
  обрывается на операторе, `,`, `(`, `[` или слове вроде `await` (`OPEN_END`), строка после неё не продолжает
  выражение (`.`, `?.`, оператор, `(`, `[`, template literal — `CONTINUES`). `expect(0)` перед существующей
  `.toBe(0)` и assertion после `const sum =` — поломка.
- Пункт 4: код вне test-ов сравнивается тоже — новое значение `altered_outside` (число файлов). Import-ы
  сравниваются по модулю и связям: каждый модуль и каждая связь из `base` остаются, новая связь не называется
  `test`, `it`, `describe`, `expect`, `assert`; остальные строки вне test-ов — без изменений. `if (false) {`
  вокруг целого test-а, `const test = () => {}`, `test` из другого модуля, `add` из другого модуля — поломка;
  выросший import, новый import, новый test (и с `;` после него) — честно.
- Пункт 3: правило не расширено, ложные срабатывания описаны в `scripts/eval-outcome/README.md`, Known limits
  (многострочная assertion, `const r = …`, `await expect(…)`, `test.todo(`, helper на верхнем уровне); test
  проверяет, что раздел их называет.

Круг ревью 1 PR #719 (REJECT: одна med, пять low), исправлено:

- med: новый test-вызов вокруг старых test-ов (новый `describe`) держит только свой callback (`, () => {` и `})`);
  `if (false) {` внутри него — `altered_outside`. Голый новый `describe` вокруг старых test-ов — честно.
- Одиночный `\r`, U+2028 и U+2029 — перевод строки (JavaScript заканчивает на них строку и `//` comment): файл
  приводится к `\n` до разбора.
- `,` на глубине 0 в добавленной assertion — два выражения, поломка.
- Новый модуль, импортированный только ради побочного эффекта (`import './setup.mjs'`), — поломка; новый модуль
  со связями не ловится, это записано в Known limits.
- Known limits называют и ложные срабатывания `OPEN_END`: `i++`, `case x:` / `default:`, `=>`, regular expression
  literal без флагов.
- Связь import-а из `base`, переехавшая в другой модуль (`add` из `../src/fixed.mjs`), — test `moved-binding`.

Windows-прогон 5fbfa851 (run 39694646775) был красным на случае с одиночным `\r`. Причина: bash из Git for
Windows выбрасывает сырой `\r` из текста скрипта, поэтому stub-агент записывал строку без него, и проверка видела
одну целую assertion. Это не `core.autocrlf`: kept run идёт с `GIT_CONFIG_NOSYSTEM=1` и временным HOME, а blob-ы
читаются через `git cat-file` байт в байт. Исправлен test: скрипт stub-агента остаётся ASCII, байты `\r` и
U+2028 появляются при запуске через `$'…'`; имя случая выводится в сообщении assertion.

Круг ревью 2 (PASS, три low), исправлено: test-вызов внутри строки или template literal больше не считается
test-ом (удалённый test, вставленный в template, — `removed_tests`); `.fails`, `.failing` и `{ fails: true }` —
пропуск; JSDoc `testsIntact` стоит над функцией.

Test-ы — `test/contract/harness-evals-outcome.test.ts`, describe «the tests-intact check»: красные до правки,
зелёные после; каждое новое правило проверено мутантом (правило снято — test красный). В базовом файле
синтетической задачи test `add 0 0` получил выражение на две строки и цепочку `expect(…)` / `.toBe(0)`.
Windows-прогон `harness-evals-outcome.test.ts` — за Orchestrator-ом (платформенный PR).

**Результат (PR #719, merge `b1e7ce39`):**

- `tests-intact` видит строку из нескольких statement-ов, разорванную цепочку `expect(…)` / `.toBe(…)` и код вне
  тел test-ов (`altered_outside`).
- Test-вызов внутри string, template или regular expression literal — не test. `.fails`, `.failing` и
  `{ fails: true }` считаются пропуском.
- Windows: скрипт stub-агента — только ASCII, байты `\r` и U+2028 встают на место меток `@CR@` и `@LS@` при запуске.
  Windows-runner, run 39697679240 — зелёный.
- gate full — зелёный; 17 мутантов убиты.
- Долг (low):
  - JSDoc `inLiteral` (`scripts/eval-outcome-lib.mjs:480`) описывает `inLiteral(code, index)`, а функция
    принимает только `code` и возвращает предикат от `index`.
  - `literalEnd` (`:408`) заканчивает template literal на первой обратной кавычке и не видит вложенный template
    внутри `${…}`. Способа подменить через это test не найдено.
