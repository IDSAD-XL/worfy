# 04 — Проверка черновика ревью: `bin/review-draft-lint`

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 9, 10 (шаг 7); «Как работает» → «Проверка черновика»; «Вопросы владельцу», Q3; «Риски», п. 4

Платформенный Ticket: новый скрипт Harness и вынос модуля из `bin/silent-check` — Windows verdict до merge (ADR-0056).
Глубина ревью — `medium`.

## Что происходит

- Правила следов workflow живут внутри `harness/bin/silent-check` (`:14-20`): имя Epic-а, `<epic>/<NN>`,
  `Ticket <N>`, путь Workflow folder, `.scratch`, `HANDOFF`; строки авторства Claude при `attribution: off`.
  Применяются только в Silent mode или при `attribution: off`.
- Личные данные ищет `harness/lib/privacy.cjs` (`findings`: путь домашней папки, имя машины, email, токен).
- Проверки черновика ревью нет.

## Что делаем

1. Правила следов — в модуль `harness/lib/workflow-traces.cjs`; `silent-check` берёт их оттуда и ведёт себя как
   раньше (его test-ы не меняются). Вторая копия правил запрещена.
2. `harness/bin/review-draft-lint <draft.json> --rules <lint.json> [-C <папка проекта>]` (Node). Находки — spec,
   «Проверка черновика»: длина по уровню, следы workflow всегда (в любом режиме проекта), строки авторства AI,
   `privacy.cjs`, `lint.json.forbidden`. Exit 0 / 1 / 2. Значения личных данных в выводе — через `mask()`.
3. `review-draft-lint --skill <папка частного skill-а>`: каждое правило `SKILL.md` (пункт списка в разделах шаблона)
   кончается `[R<n>]`, и в `research.md` есть `## R<n> — …`. Правило без ссылки или ссылка в пустоту — находка.
4. Форматы `lint.json` и черновика — как в spec; неизвестное поле `lint.json` — exit 2 с именем поля.
5. `harness/lib/README.md` — строка о новом модуле.

## Готово, когда

- [ ] `silent-check` после выноса правил: его test-ы зелёные без правок.
- [ ] Черновик с nit-ом длиннее предела, с `.scratch/…`, с `Co-Authored-By: Claude`, с путём домашней папки и со
      словом из `forbidden` — пять находок, exit 1; чистый черновик — exit 0; битый JSON — exit 2.
- [ ] Следы workflow ловятся и в Full mode с `attribution: on`.
- [ ] `--skill`: правило без `[R<n>]` и ссылка на несуществующий раздел — находки; полный fixture — exit 0.
- [ ] Вывод не печатает найденные личные данные целиком (`mask()`).
- [ ] `ci-ok` на PR зелёный; Windows verdict есть.

## Тесты

- `test/contract/harness-review-draft-lint.test.ts` (новый): vitest запускает скрипт через node на fixture-ах во
  временной папке. Fixture-ы — выдуманные тексты.
- Сначала падающий: следы workflow в Full mode — красный, пока правило зависит от режима.
- Существующие: `harness/bin/tests/silent-mode.test.sh`, `harness/bin/tests/evidence-check.test.sh`.

## Где в коде

- `harness/bin/review-draft-lint` (новый)
- `harness/bin/silent-check`
- `harness/lib/workflow-traces.cjs` (новый)
- `harness/lib/README.md`
- `test/contract/harness-review-draft-lint.test.ts` (новый)

Только читать: `harness/lib/privacy.cjs`, `harness/lib/input-words.json`.
