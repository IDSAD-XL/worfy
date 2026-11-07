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
  - evidence: test-run pass · `bash harness/bin/tests/silent-mode.test.sh` exit 0 · mac - · b5711b1bb7519b9d111b8a4b217a8eb5bd195eca
  - evidence: test-run pass · `bash harness/bin/tests/silent-mode.test.sh` exit 0 · mac - · 37ebb6ca85f7cf7f289716d7b6ad146dc52cde9e
  - evidence: gate pass · `gate fast` exit 0 · mac - · 37ebb6ca85f7cf7f289716d7b6ad146dc52cde9e
- [ ] Черновик с nit-ом длиннее предела, с `.scratch/…`, с `Co-Authored-By: Claude`, с путём домашней папки и со
      словом из `forbidden` — пять находок, exit 1; чистый черновик — exit 0; битый JSON — exit 2.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-review-draft-lint.test.ts` exit 0 · mac - · b5711b1bb7519b9d111b8a4b217a8eb5bd195eca
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-review-draft-lint.test.ts` exit 0 · mac - · 37ebb6ca85f7cf7f289716d7b6ad146dc52cde9e
- [ ] Следы workflow ловятся и в Full mode с `attribution: on`.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-review-draft-lint.test.ts` exit 0 · mac - · b5711b1bb7519b9d111b8a4b217a8eb5bd195eca
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-review-draft-lint.test.ts` exit 0 · mac - · 37ebb6ca85f7cf7f289716d7b6ad146dc52cde9e
- [ ] `--skill`: правило без `[R<n>]` и ссылка на несуществующий раздел — находки; полный fixture — exit 0.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-review-draft-lint.test.ts` exit 0 · mac - · b5711b1bb7519b9d111b8a4b217a8eb5bd195eca
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-review-draft-lint.test.ts` exit 0 · mac - · 37ebb6ca85f7cf7f289716d7b6ad146dc52cde9e
- [ ] Вывод не печатает найденные личные данные целиком (`mask()`).
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-review-draft-lint.test.ts` exit 0 · mac - · b5711b1bb7519b9d111b8a4b217a8eb5bd195eca
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-review-draft-lint.test.ts` exit 0 · mac - · 37ebb6ca85f7cf7f289716d7b6ad146dc52cde9e
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

## Итог

Ветка `worfy-human-review/04`.

- **Модуль `harness/lib/workflow-traces.cjs`** — правила следов workflow (имя Epic-а, `<epic>/<NN>`, номер ADR, `Ticket <N>`
  и слово «ticket» из `lib/input-words.json`, путь Workflow folder, `.scratch`, `HANDOFF`), строки авторства Claude и поиск
  с правилом «найденный кусок второй раз не находится». Данные (корень тикетов, `input-words.json`) читает вызывающий
  скрипт. `silent-check` берёт правила оттуда; своей копии правил в нём нет. Порядок в `silent-check`: сначала
  `input-words.json`, потом модуль — так test «битый `input-words.json`» из `silent-mode.test.sh` (копия одного
  `silent-check` без `lib/`) даёт тот же exit 2 с той же причиной. Test-ы `silent-check` не менялись.
- **`harness/bin/review-draft-lint`** — формат черновика `{ payload, tiers, body_tier }` и `lint.json`
  (`schema: 1`, `tiers.<уровень>.max_chars`, `forbidden`) — как в spec. Находка — строка `<где>: <правило> …`, где `<где>` —
  `body` или `comments[<i>] <path>:<line>`. Все значения в выводе проходят `privacy.maskText`, находки личных данных —
  `privacy.mask`. Вне зарегистрированного проекта имена Epic-ов и Workflow folder не проверяются, об этом строка в stderr.
- **`--skill <папка>`** — правило — пункт списка под заголовком `## ` (и его `###`), вне блоков кода (`lib/code-fence.cjs`),
  с продолжением на следующих строках; должен кончаться одной или несколькими `[R<n>]`. Раздел `research.md` —
  `## R<n> — <заголовок>` (тире `—`, `–` или `-`).
- `harness/lib/README.md` — строка о модуле; `docs/features/harness.md` — строка `review-draft-lint` в таблице скриптов
  (страница Feature описывает список скриптов; перевод не правится, ADR-0088).

Решено без владельца:

1. Номер ADR — тоже след в черновике: spec велит «те же правила, что у `silent-check`», а там он есть. Цена: команда,
   которая сама ссылается на свои ADR, получит находку и перепишет фразу.
2. Голое имя Epic-а ищется во всех текстах черновика, как в тексте у `silent-check` (не как в строках diff). Epic, названный
   по области кода (`deals`), даст ложную находку в комментарии про эту область.
3. Уровень, которого нет в `lint.json.tiers`, — exit 2 (ошибка входа), а не «предела нет». `body_tier` обязателен, когда
   `payload.body` не пустой. Неизвестное поле верхнего уровня черновика — тоже exit 2; `payload` проверяется только в
   полях, которые читает скрипт (тело GitHub-запроса «как есть»).
4. Слово `forbidden` ищется без учёта регистра как целое слово; одна находка на слово в тексте.
5. Длина — в символах Unicode (code points), не в байтах.

Проверки:

- Сначала красный: `node scripts/vitest-electron.mjs test/contract/harness-review-draft-lint.test.ts` до скрипта —
  exit 1, 9 из 9 test-ов красные (скрипта нет). После — exit 0, 9 из 9.
- `bash harness/bin/tests/silent-mode.test.sh` — exit 0 (95 passed), без правок test-а; `evidence-check.test.sh` — exit 0
  (233); `ticket-evidence.test.sh`, `land.test.sh`, `hooks/tests/guard-silent.test.sh`, `skill-blocks.test.sh`,
  `eval-env.test.sh`, `plugin-neutral.test.sh`, `agents-text.test.sh` — exit 0.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (681 файлов) — exit 0.
- Gate fast (Mac, load average около 70 от параллельных агентов) — три запуска, все exit 2. Первый: красный мой test —
  gate запускает test-ы с `CLAUDE_GATE_CONFIG` настоящего registry, и скрипт читал его, а не временный `HARNESS_HOME`;
  test теперь убирает эти переменные (второй commit). Второй и третий: красные только чужие test-ы, каждый раз другие
  (`test/contract/autopilot-wait.test.ts` — timeout ожидания Wave, `test/contract/remote-calls.test.ts`;
  в первом ещё `test/unit/install-stable-update.test.ts`). Все три отдельно — exit 0 (63 из 63). Diff их кода не трогает.

Ревью, раунд 1 (REJECTED: test не проверял номер ADR) — исправлено:

- В test добавлены случаи для номера ADR, голого имени Epic-а, `Generated with [Claude Code`, пути Workflow folder
  Silent-проекта (второй проект `sp` во временном `HARNESS_HOME`), маски в значении следа (имя машины в пути Workflow
  folder), маски в строках ошибок exit 2, BOM в начале файлов и длины в символах (emoji: 105 символов при 205 UTF-16).
- Скрипт: строки ошибок exit 2 тоже проходят `maskText` (маскирование — в `die()`, одно место); BOM UTF-8 в начале
  файла отбрасывается до `JSON.parse` (PowerShell на Windows пишет его).
- Mutants (каждый — копия файла, правка, test, восстановление из копии), все убиты, exit 1: без правила ADR, без голого
  имени Epic-а, без правила Workflow folder, без `Generated with`, `show = v => v`, `die()` без `show`, значение следа
  без `show`, без снятия BOM, длина через `.length`. Test после восстановления — exit 0, 14 из 14.
- После rebase на origin/main: `pnpm lint`, `pnpm typecheck`, `silent-mode.test.sh`, `plugin-neutral.test.sh` — exit 0;
  gate fast на `37ebb6ca` — exit 0, `[gate] green (fast)`. В отдельном `pnpm test` перед этим один чужой test упал под
  нагрузкой (`test/contract/app-orchestrators.test.ts`, Codex после New conversation); отдельно — exit 0.
