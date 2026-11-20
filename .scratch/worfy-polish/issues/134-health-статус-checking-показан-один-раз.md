# 134 — Health: статус «Checking…» показан один раз, на кнопке

Type: bug
Status: open
Blocked by: none
Source: скриншот и слова владельца 2026-11-20 «В health дублируется статус чип».

Кто: агент. Глубина review — `low`. Не платформенный PR.

## Что происходит

- Settings → Health и диалог First run показывают проверки Machine из одного компонента
  `FirstRunChecks` (`src/renderer/shell/FirstRunChecks.tsx`); раскладку делают `HealthSection.tsx` и `FirstRun.tsx`.
- Пока идёт проверка («Check again» или проверка при открытии), состояние «Checking…» видно дважды в одной строке:
  - chip-итог слева под заголовком (`summary`, `data-testid="first-run-summary"`) пишет «Checking…»;
  - кнопка справа пишет «⟳ Checking…» со spinner-ом (`BusyLabel`, worfy-polish 77).
- Два одинаковых слова рядом читаются как повтор, а не как два разных факта.

## Что делаем

1. Кнопка «Check again» остаётся единственным знаком идущей проверки: она — control, на ней spinner и «Checking…»
   (поведение worfy-polish 77 не меняется).
2. Chip-итог показывает только результат проверки: «Everything is ready», «2 failed · 1 warning» и т. п. Пока проверка
   идёт, chip-а нет — ни «Checking…», ни прошлого результата (он устарел, пока идёт новая проверка).
3. Chip-и строк («Checking…» на каждой строке во время «Check again», «Running…» на строке действия) не меняются.
4. `docs/features/onboarding.md` (и перевод `docs/features/ru/onboarding.md`): chip-итог — только результат.

## Готово, когда

- [ ] Unit test `test/unit/settings-health.test.tsx`: пока идёт проверка, chip-а `first-run-summary` нет ни в Health, ни
      в First run, кнопка — «Checking…» со spinner-ом; после ответа chip показывает итог. Красный до правки.
- [ ] Снимки Playwright Health в светлой и тёмной теме — во время проверки и после неё (в scratchpad, названы в «Итог»).
- [ ] `docs/features/onboarding.md` и `docs/features/ru/onboarding.md` описывают chip-итог без «Checking…».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.

## Где в коде

- `src/renderer/shell/FirstRunChecks.tsx` (`summary`, `FIRST_RUN_CHIP`, кнопка `checkAgain`)
- `src/renderer/settings/HealthSection.tsx`, `src/renderer/shell/FirstRun.tsx` — только читать (раскладка частей)
- `test/unit/settings-health.test.tsx`
- `test/e2e/settings-health.spec.ts`, `test/e2e/first-run.spec.ts`, `test/e2e/guide-entry-links.spec.ts`,
  `test/e2e/getting-started-entry.spec.ts`, `test/e2e/harness-migrate.spec.ts`, `test/acceptance/e3.spec.ts` — ждут
  конца проверки по chip-у (`not.toHaveText('Checking…')`)
- `docs/features/onboarding.md`, `docs/features/ru/onboarding.md`

## Вне скоупа

- Chip «Checking…» на каждой строке во время «Check again» — отдельный вопрос, владелец его не называл.
- Другие экраны со spinner-ом на кнопке.
