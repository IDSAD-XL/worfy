# 06 — Settings → Health: проверки First run в окне Settings

Type: task
Status: open
Blocked by: 02
Source: решение владельца 2026-10-09: 2 (раздел Health окна Settings — проверки First run; First run при первом запуске остаётся) ([spec.md](../spec.md), «Решения владельца», пункт 2; «Пересечения», worfy-windows 13 и 15); [ADR-0052](../../../docs/adr/0052-machines-and-linking.md), пункт 6 (каналы `firstRun.*` — `local`)

## Что происходит

- Проверки здоровья worfy — экран First run: `src/renderer/shell/FirstRun.tsx:190`, заголовок
  «First run» (`:263`), «Check again» (`:294`). Вид и правила — `docs/design/F-SPEC.md:98-116`:
  диалог поверх окна, строка проверки — chip статуса, имя, найденное, кнопки; под ней hint и
  команда с «Copy».
- Открывается он:
  - сам при старте, когда main просит (`askAtStartup`, `src/renderer/shell/first-run-store.ts:54`);
  - пунктом палитры «First-run checks», группа View (`src/renderer/palette/commands.ts:184-193`);
  - кнопками «First-run checks…» в подключении Project-а (`src/renderer/projects/ConnectProject.tsx:555`)
    и во входе в GitHub (`src/renderer/projects/GithubAccount.tsx:216`).
- State — zustand-store `useFirstRun` (`first-run-store.ts:17`): открыт ли экран, отчёт, идёт ли
  проверка, ошибка.
- Каналы — `firstRun.checks` (`src/shared/ipc/first-run.ts:80`), `firstRun.run` (`:88-89`),
  `firstRun.close` (`:105`), все `local`. `firstRun.close` пишет отметку `first-run.json`
  (`src/main/ipc/first-run.ts:7`, `:147`): по ней First run больше не открывается сам.
- Ticket-ы 13 и 15 worfy-windows (открыты) добавляют проверки в `src/main/first-run/checks.ts`.
  `src/renderer/shell/FirstRun.tsx` Ticket 13 правит, только если экран не рисует новую проверку
  (`.scratch/worfy-windows/issues/13-первый-запуск-на-windows.md:184-185`); группы проверок заданы
  списком `GROUPS` (`FirstRun.tsx:26`) и схемой `checkGroupSchema`
  (`src/shared/ipc/first-run.ts:38`).
- После Ticket-а 02 есть окно Settings и разделы по файлам `src/renderer/settings/*Section.tsx`.

## Что делаем

1. **Тело First run** — список проверок со статусами, hint-ами, командами, «Copy», действиями
   с подтверждением и «Check again» — выносится в `src/renderer/shell/FirstRunChecks.tsx` (новый).
   Диалог First run показывает его, как сейчас: при старте, по палитре и по кнопкам — поведение не
   меняется.
2. **Раздел Health** — `src/renderer/settings/HealthSection.tsx` (новый, `order` 20, `title`
   «Health») показывает тот же список. Открытие раздела запускает проверку (`firstRun.checks`);
   «Check again» — ещё раз; действия — те же, через `firstRun.run` с подтверждением.
3. **Закрытие Settings не пишет отметку** `first-run.json`: её пишет только закрытие диалога First
   run (`firstRun.close`).
4. Отчёт и ход проверки — общие с диалогом (`useFirstRun`): проверка, запущенная в одном месте,
   видна в другом.
5. Список `GROUPS` уходит вместе с телом в `FirstRunChecks.tsx`. Если к claim Ticket 13
   worfy-windows открыт и правит `FirstRun.tsx` — сверка по правилу spec-а («Пересечения»); влитый
   после этого Ticket 13 правит уже `FirstRunChecks.tsx`, об этом — запись в «Итог».

Решено в Ticket-е, подтвердить у владельца: пункт палитры «First-run checks» по-прежнему открывает
диалог First run, а не Settings → Health.

**Не входит:** новые проверки (worfy-windows 13 и 15); изменение вида строк First run; отдельные
каналы для Health.

## Готово, когда

- [ ] Unit `test/unit/settings-health.test.tsx` (новый): раздел показывает строки отчёта
  `firstRun.checks` (имя, статус, найденное); «Check again» зовёт `firstRun.checks` ещё раз; действие
  идёт через подтверждение и `firstRun.run`; закрытие Settings не зовёт `firstRun.close`.
- [ ] e2e `test/e2e/settings-health.spec.ts` (новый): Settings → Health показывает те же проверки,
  что диалог First run (по именам строк); если отметки `first-run.json` не было, после закрытия
  Settings её в папке данных по-прежнему нет. Снимки `settings-health` в светлой и тёмной теме.
- [ ] e2e `test/e2e/first-run.spec.ts` зелёный без правок: диалог First run не изменился.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `GATE_SCOPE=all` gate full локально —
  exit 0.

## Тесты

Сначала падающий test — unit «раздел Health показывает строки отчёта»: раздела нет. Вынос тела —
под защитой `test/e2e/first-run.spec.ts`, он не меняется. В «Итог» — как падал первый test.

## Где в коде

- `src/renderer/shell/FirstRun.tsx`
- `src/renderer/shell/FirstRunChecks.tsx` (новый)
- `src/renderer/settings/HealthSection.tsx` (новый)
- `test/unit/settings-health.test.tsx` (новый)
- `test/e2e/settings-health.spec.ts` (новый)

## Итог

Заполняется при закрытии.
