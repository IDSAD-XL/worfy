# 134 — Health: статус «Checking…» показан один раз, на кнопке

Type: bug
Status: done 2026-11-20T03:54Z
PR: #2056
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
  - evidence: test-run pass · `pnpm test test/unit/settings-health.test.tsx test/unit/first-run-dialog.test.tsx` exit 0 · mac - · 5f00066f5
- [ ] Снимки Playwright Health в светлой и тёмной теме — во время проверки и после неё (в scratchpad, названы в «Итог»).
- [ ] `docs/features/onboarding.md` и `docs/features/ru/onboarding.md` описывают chip-итог без «Checking…».
  - evidence: commit pass · fix(health): show the running check once, on the Check again button · - - · 5f00066f5
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` зелёный на head PR.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44665681668/job/136066421949 · ci - · 8b3ab410d3a490f1c4fe55970bda5345967ac22d

## Где в коде

- `src/renderer/shell/FirstRunChecks.tsx` (`summary`, `FIRST_RUN_CHIP`, кнопка `checkAgain`)
- `src/renderer/settings/HealthSection.tsx`, `src/renderer/shell/FirstRun.tsx` — только читать (раскладка частей)
- `test/unit/settings-health.test.tsx`
- `test/e2e/settings-health.spec.ts`, `test/e2e/first-run.spec.ts`, `test/e2e/guide-entry-links.spec.ts`,
  `test/e2e/getting-started-entry.spec.ts`, `test/e2e/harness-migrate.spec.ts`, `test/acceptance/e3.spec.ts` — только
  читать: ждут конца проверки через `not.toHaveText('Checking…')` на chip-е; Playwright повторяет такое ожидание, пока
  элемента нет, так что без chip-а оно ждёт chip с итогом
- `docs/features/onboarding.md`, `docs/features/ru/onboarding.md`

## Вне скоупа

- Chip «Checking…» на каждой строке во время «Check again» — отдельный вопрос, владелец его не называл.
- Другие экраны со spinner-ом на кнопке.

## Итог

- **Решено без владельца, подтвердить:** единственный знак идущей проверки — кнопка «Check again» («Checking…» со
  spinner-ом), потому что она и есть control. Chip-итог слева показывает только результат проверки; пока проверка идёт,
  chip-а нет совсем — прошлый результат тоже не показан, он устарел. Chip-и строк («Checking…», «Running…») не менялись.
- Правка — `src/renderer/shell/FirstRunChecks.tsx`: `summary` пустой, пока `checking`; chip-итог больше не берёт вид
  `running`. Health и диалог First run берут chip из одного места, поэтому изменились оба.
- Сначала падающий test: `test/unit/settings-health.test.tsx` на старом коде — 7 красных (chip `first-run-summary` был
  «Checking…»), после правки — 51/51 зелёные.
- e2e без правок: `pnpm test:e2e test/e2e/settings-health.spec.ts test/e2e/first-run.spec.ts` — 13 passed, exit 0.
- Снимки Playwright своей сборки с fixture-данными (scratchpad, в репозиторий не кладутся):
  `/tmp/worfy-night-1120/impl-polish-134/health-checking-light.png`, `health-checking-dark.png` (идёт проверка: слева
  chip-а нет, справа кнопка «Checking…»), `health-after-light.png`, `health-after-dark.png` (после: chip
  «1 failed · 2 warnings», кнопка «Check again»).
