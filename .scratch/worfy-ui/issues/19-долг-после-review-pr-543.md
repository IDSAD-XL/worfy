# 19 — Долг после review PR #543 (Toolbar: Limits без «as of», Harness в две строки)

Type: task
Status: claimed 2026-10-21T13:11Z
Branch: worfy-ui/19
Blocked by: —
Source: review PR #543 (worfy-ui 18), раунд 2, находки уровня low, 2026-10-19. Строки — по голове PR,
влитой в main как `44e22e74`.

## Что происходит

Review второго раунда PR #543 не нашёл находок high и medium. Четыре находки low остались:

- **Лишний `.catch` в limits-usage.** `src/main/agent/limits-usage.ts:172-173`: `asked.catch(…)` не
  нужен — отказ `asked` уже ловит `Promise.race`. Комментарий над ним описывает поведение неверно.
- **Нет test-а: у значения устаревшей полосы нет title.** `src/renderer/LimitBar.tsx:51` — после #543
  строка «as of» убрана, и у span-а значения не должно быть подсказки; test этого не проверяет.
- **Нет test-а на форму иконки Update.** `src/renderer/HarnessStatus.tsx:137` — кнопки Update Harness и
  Move old стали иконками с tooltip; test проверяет tooltip, но не то, что это иконка.
- **Нет test-а на класс `--compact` 20×20.** `src/renderer/HarnessStatus.tsx:68`.

## Что делаем

1. Убрать `asked.catch` и неверный комментарий в `limits-usage.ts`; test на отказ `asked` остаётся
   зелёным.
2. Добавить три unit test-а: нет `title` у значения устаревшей полосы; кнопка Update — иконка (svg, без
   текста) с tooltip; у иконок есть класс `--compact`.

## Готово, когда

- [x] `limits-usage.ts` без `asked.catch`; test-ы limits-usage зелёные.
- [x] Три новых test-а; каждый краснеет на mutant-е, который возвращает старое поведение.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Где в коде

- `src/main/agent/limits-usage.ts` (`:172-173`)
- `src/renderer/LimitBar.tsx` (`:51`)
- `src/renderer/HarnessStatus.tsx` (`:68`, `:137`)

## Вне скоупа

- Регистрация процесса limits-usage в `~/.claude/sessions` — решение владельца в worfy-terminal-ai 16, п. 2.

## Итог

Ветка `worfy-ui/19`, от main `23dc8439`. После `44e22e74` ни один коммит main не трогал
`limits-usage.ts`, `LimitBar.tsx`, `HarnessStatus.tsx` и `shell.css`: все четыре находки на main
были открыты, ни одну не закрыл другой PR. Файлы worfy-ui 21 (`src/renderer/orchestrator/*`,
`usePastAnswer`) этот Ticket не трогает.

Пути в разделе «Где в коде» устарели: `LimitBar.tsx` лежит в `src/renderer/limits/`,
`HarnessStatus.tsx` — в `src/renderer/shell/toolbar/`; строки те же.

1. **`asked.catch` убран** (`src/main/agent/limits-usage.ts`, `sdkUsageReader`). Находка верна:
   `Promise.race` подписывается на оба promise, и отказ метода usage после timeout или abort уже
   обработан. Неверный комментарий заменён одной верной строкой. Test «a usage method that rejects
   after the timeout or the abort leaves no unhandled rejection» (`test/unit/limits-usage.test.ts`)
   остался зелёным без `.catch`, и он живой: mutant, который вешает на ответ неподписанный
   `.finally`, роняет его (необработанный отказ).
2. **Нет `title` у значения устаревшей полосы** — новый test в `test/unit/limits-meter.test.tsx`:
   у свежей полосы `title` значения — `62%`, у устаревшей — нет. Mutant `title={bar.value}` → красный.
3. **Кнопка Update — иконка.** Проверка svg и пустого текста для Update Harness уже была в
   `44e22e74` — в общем test-е «Install, Update Harness and Retry are icon buttons» (цикл по трём
   состояниям). Находка указывала на test подсказки Update; туда добавлены те же две проверки, чтобы
   test подсказки сам ловил кнопку со словами. Mutant «Update рисуется текстом» роняет оба test-а.
4. **Класс `--compact` 20×20** — новый test в `test/unit/harness-status.test.tsx`: у всех шести
   иконок (Install, Update Harness, Retry и Move old Harness… при каждом из трёх состояний) есть
   класс `w-toolbar__icon-button--compact`, а правило в `src/renderer/shell/shell.css` задаёт
   `width: 20px` и `height: 20px` (jsdom не грузит CSS, правило читается из файла, как в
   `minimap-paint.test.tsx`). Mutant-ы «без класса» и «24px в правиле» → красный.

Mutant-ы — 5 из 5 убиты, каждый в worktree этого Ticket-а, с восстановлением файла из копии.

Проверки (HOME во временной папке, GH_TOKEN снят):
- `pnpm lint` — exit 0; `pnpm typecheck` — exit 0.
- `pnpm test` целиком, один раз — exit 0: 368 файлов прошли, 6 пропущено; 7778 test-ов прошли,
  83 пропущено.
- e2e не запускались: test-ы и код Ticket-а — unit, e2e-spec-ов он не меняет.

**Не платформенный PR** (ADR-0056, п. 2): нет веток по платформе, скриптов Harness и упаковки;
`check/windows` — `skipped`.
