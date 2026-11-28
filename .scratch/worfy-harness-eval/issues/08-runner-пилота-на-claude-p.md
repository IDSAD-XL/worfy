# 08: Runner пилота на `claude -p`: container на run, ветки, вход, лимиты, секреты; счёт — scorer

Type: task
Status: open
Blocked by: 01, 02
Source: [spec.md](../spec.md), «Ticket-ы», 08; «Решения владельца», «Подписка» (Q22) и «Задачи пилота» (Q17–Q22);
«Решено советником» (запись о run-е пилота; grader-ы вне container-а; режим разрешений явно, порядок случайный, нет
GH_TOKEN); «Решения по реализации» («Runner пилота», «Ветки пилота»); «Решения по test-ам» (runner пилота); critic
2026-11-24, возражения 1 (подсчёт — готовый `scripts/eval-outcome-score.mjs`) и 2 (01 и 02 блокируют 08); «Риски»
(token в container-е, образы x86_64 на Mac); [worfy-harness 52](../../worfy-harness/issues/52-сравнительный-eval-исходов-worfy-против-claude-code-без-plugin.md)
— этот Ticket вместе с 09–12 заменяет его; «Волны», Wave 2

Кто: агент. Глубина ревью — `high`: token подписки и API key в окружении container-а, стоп по лимиту и публикация
зависят от этого кода.

Бесплатно: весь Ticket — на stub-е `claude` и stub-е container-а. Платных run-ов нет; первый — отбор (Ticket 11).

## Что происходит

- Сравнение с Claude Code без plugin-а планировал Ticket worfy-harness 52 (blocked с 2026-10-21, ждёт владельца); его
  задачи игрушечного размера, а grader-ы `claude plugin eval` лежат в копии plugin-а `harness/evals-outcome/`.
- У `claude plugin eval` нет выбора режима разрешений: нет auto mode и Autopilot-ветки. Нужен свой запуск на
  `claude -p`.
- Подсчёт исхода уже есть: `scripts/eval-outcome-score.mjs` считает `false_done` и `test_tampered`, проверки вида
  `command`, `tests-intact`, `origin-has`, `files-kept`, `judge` (`scripts/eval-outcome/README.md:52-68`); скрытые
  test-ы лежат в `scripts/eval-outcome/hidden/` и копируются в рабочую папку только после run-а.
- Долю недели worfy берёт опросом лимитов: `src/main/vendors/claude/limits.ts` (короткий процесс Claude Code, token-ы
  модели не тратит), расписание — `src/main/agent/limits-usage.ts`. События `rate_limit_event` приходят не всегда.

## Что строить

- Новый runner (предложение: `scripts/eval-pilot.mjs` и `scripts/eval-pilot/`; имя выбирает Ticket). Подсчёта своего
  нет: рабочую папку каждого run-а он отдаёт `scripts/eval-outcome-score.mjs`.
- Каждый run — свежий container из образа задачи: Claude Code закреплённой версии; в ветках worfy — копия plugin-а
  Harness с commit-а пилота и node для его hook-ов. У всех container-ов одинаковые лимиты CPU и памяти.
- Вход: token подписки от `claude setup-token` или API key организации Console. Оба лежат только в папке состояния
  Harness на машине; ключ читается тем же кодом, что в Ticket-е 01. В окружении container-а нет GH_TOKEN и других
  token-ов, кроме одного из этих двух. API key берётся, только когда запуск просит кредиты.
- Модель — константа модели пилота из Ticket-а 02 (`claude-opus-5-5`). Run, в результате которого другая модель, не
  засчитывается.
- Ветки (каждая со своими флагами и prompt-ом; режим разрешений передаётся всегда явно):
  - worfy, обычная работа: задача обычной фразой, plugin загружен, `bypassPermissions` — режим нового Session Node-а
    (`src/shared/agent/settings.ts:57`); ход, закончившийся вопросом, получает один ответ «решай сам» в той же Session,
    вопрос записывается;
  - Claude Code без plugin-а в `bypassPermissions`;
  - Claude Code без plugin-а в auto mode — на задачах про опасные действия;
  - worfy, Autopilot — Ticket 09 (здесь только место для ветки).
- Лимиты: опрос долей недели тем же способом, что `limits.ts`; `rate_limit_event` — дополнительный источник. Стоп на
  первом отказе по лимиту или на 80 % недели; продолжение после сброса. Run, оборванный лимитом, повторяется и
  провалом не считается.
- Порядок run-ов случайный (seed в записи), ветки вперемешку.
- Запись о run-е: ветка, задача, модель из результата run-а, версия Claude Code, цена по ценам API, token-ы, минуты,
  ходы, вызванные skill-ы и subagent-ы, заданные вопросы, исход по каждой метрике.
- Поиск секретов перед публикацией: в сырых результатах ищутся token подписки и API key (их значения с машины и их
  формы). Находка — публикации нет, runner называет файл.
- `--dry-run`: план run-ов, ветки, счёт и оценка доли недели без вызова модели; token маскирован.
- Grader-ы и скрытые test-ы лежат вне container-а агента и попадают туда только после run-а.
- Runner не знает семейств задач: задача для него — образ, prompt и проверки scorer-а (Ticket 10). Кандидат в
  источник задач SCBench (Ticket 19) зависит от ответа spike-а; если владелец его возьмёт, а его checkpoint-ы требуют
  нескольких prompt-ов подряд в одной Session, это добавляет Ticket 10 или новый Ticket, не этот.

## Где в коде

- `scripts/eval-pilot.mjs`, `scripts/eval-pilot/` (новые, имена — предложение)
- `scripts/eval-outcome-score.mjs`, `scripts/eval-outcome-lib.mjs` — только вызов scorer-а
- `scripts/eval-run-env.mjs` — константа модели пилота (Ticket 02), чтение ключа (Ticket 01)
- `src/main/vendors/claude/limits.ts`, `src/main/agent/limits-usage.ts` — как опрашивать лимиты (только читать или
  вынести общую часть)
- `src/shared/agent/settings.ts:57` — только читать: режим нового Session Node-а
- `test/contract/eval-pilot.test.ts` (новый, имя — предложение)
- `package.json` — `eval:pilot`

## Test-ы

- Contract test-ы со stub-ом `claude` и stub-ом container-а:
  - каждая ветка получает свои флаги и prompt, режим разрешений передаётся явно;
  - run с другой моделью не засчитывается; оборванный лимитом run повторяется; на 80 % недели runner
    останавливается;
  - окружение container-а не содержит GH_TOKEN;
  - поиск секретов находит подложенный token и ключ, публикации нет;
  - рабочая папка run-а уходит в `scripts/eval-outcome-score.mjs`, своего подсчёта у runner-а нет;
  - изнутри container-а агента grader-ы и скрытые test-ы не видны.
- Сначала падающий test: stub container-а печатает своё окружение, и в нём нет GH_TOKEN.
- Без моделей и без денег в CI; настоящий binary Codex не запускается.

## Готово, когда

- [ ] Runner на `claude -p`: container на run, три ветки (worfy обычная, без plugin-а в `bypassPermissions`, без
      plugin-а в auto mode) и место для Autopilot-ветки.
- [ ] Вход через token подписки или API key только из папки состояния Harness; в окружении container-а нет GH_TOKEN.
- [ ] Стоп на первом отказе по лимиту или на 80 % недели; оборванный run повторяется.
- [ ] Подсчёт — только `scripts/eval-outcome-score.mjs`; run с другой моделью не засчитывается.
- [ ] Поиск секретов перед публикацией находит подложенный token; contract test-ы проверяют всё перечисленное.
- [ ] `--dry-run` печатает план без вызова модели.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
