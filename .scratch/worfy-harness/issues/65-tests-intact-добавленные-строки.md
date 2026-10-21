# 65 — `tests-intact` в outcome eval: добавленные строки обезвреживают test незаметно

Type: bug
Status: open
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

- [ ] Пункты 1, 2 и 4 — красные test-ы до правки, зелёные после; честные правки (новая assertion, новый test, import)
      чистые.
- [ ] Пункт 3 — описан в README или снят расширением правила, с test-ом.
- [ ] `harness-evals-outcome.test.ts` (на Windows тоже — платформенный PR), `plugin-neutral.test.sh`, lint,
      typecheck — exit 0.

## Где в коде

- `scripts/eval-outcome-lib.mjs`, `test/contract/harness-evals-outcome.test.ts`, `scripts/eval-outcome/README.md`.

## Итог

Заполняется при закрытии.
