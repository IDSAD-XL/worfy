# 16 — Update показывает, что идёт сборка: шаг, время, отказ

Type: task
Status: claimed 2026-11-01T16:36Z
Blocked by: —
Source: отчёт владельца 2026-11-01 (после «Update worfy» нет никакой индикации загрузки или прогресса); карта scout-а того же дня.

## Что происходит

- Клик «Update worfy» (chip toolbar `src/renderer/update/UpdateChip.tsx:93`, Settings `src/renderer/settings/UpdatesBlock.tsx:105`,
  Command palette `src/renderer/palette/commands.ts:598`, toast «Update» `src/renderer/update/toasts.ts:159`) вызывает
  `update.install`. Сборка (`src/main/update/build.ts`) идёт минуты: git clone/fetch, `pnpm install` (с download Electron),
  при обрыве — `node node_modules/electron/install.js`, `pnpm package`.
- `build.phase` — только `idle | building | ready | failed` (`src/shared/ipc/update.ts`); шагов нет. Main шлёт
  `update.changed` только в начале и в конце.
- Что видно во время сборки: на chip-е текст не меняется (`v<версия>` с точкой), «Building worfy X…» — только в tooltip и
  в неактивном пункте меню; в Settings — строка статуса без движения; из Command palette и из toast-а «Update» — ничего.
  Отказ `update.install` пишется только в console (`UpdateChip.tsx:77-79`).
- После «Restart now» до закрытия окна (до 2 минут ожидания `install-stable --wait-pid`) состояния «перезапуск идёт» нет.
- Spec (R11) обещает во время автоматической сборки только точку и tooltip; клик пользователя и шаги spec не описывает.

## Что делаем (решения Orchestrator-а 2026-11-01, владелец просил исправить)

1. **Шаг сборки в состоянии.** `build.step`: `fetch` (clone или fetch, checkout) | `install` (`pnpm install`) |
   `electron` (докачка Electron) | `package` (`pnpm package`) и `build.stepStartedAt`, `build.startedAt` — ISO.
   Main пишет шаг перед каждым spawn и шлёт `update.changed` на каждой смене шага. Log main не читает. Новые поля
   необязательные: старое состояние без них читается.
2. **Chip во время сборки виден без наведения.** Вместо `v<версия>` — индикатор вращения (с `prefers-reduced-motion` —
   без вращения) и текст шага: `Updating · 2/4 Installing dependencies`; tooltip — шаг и время с начала сборки
   (`Building worfy X… 3:12`), обновляется раз в секунду, пока открыт. Тексты шагов: `Fetching source`,
   `Installing dependencies`, `Downloading Electron`, `Building app`. Счётчик `N/4` (шаг `electron` бывает не всегда —
   тогда шагов 3 и счёт `N/3`).
3. **Settings → Updates**: та же строка шага и прошедшее время, кнопка `Show log` рядом во время сборки.
4. **Клик даёт ответ сразу.** До первого `update.changed` chip и кнопка Settings уже в состоянии «Starting update…».
   Отказ `update.install` (нет git/node/pnpm, уже идёт сборка, нет цели) — toast с текстом отказа и `Show log`, если log есть;
   то же из Command palette и из toast-а «Update».
5. **Перезапуск.** После «Restart now» / «Restart when idle», когда перезапуск начался, chip показывает `Restarting…`
   до закрытия окна.
6. Toast-а «идёт сборка» нет — R11 остаётся: индикатор — chip.
7. Процента download Electron нет (main не читает вывод `install.js`); шаг `Downloading Electron` и время — достаточно.
   Записать в «Итог», если окажется, что процент дёшев.

## Готово, когда

- [x] Unit: chip в `building` показывает шаг и `N/M` без наведения; tooltip — время; reduced motion без анимации;
      «Starting update…» до первого `update.changed`; отказ → toast; `Restarting…`.
- [x] Unit Settings: строка шага, время, `Show log`.
- [x] Contract `test/contract/update-build.test.ts`: шаги идут `fetch → install → (electron) → package`, каждая смена шлёт
      `update.changed`; старое состояние без `step` читается.
- [x] e2e `test/e2e/update-toolbar.spec.ts` (gated `WORFY_UPDATE_BUILD`): после клика chip сразу меняется, видны шаги
      по очереди, затем «Restart now».
- [x] Снимки chip-а и Settings во время сборки в обеих темах в `.scratch/worfy-update/evidence/16-*.png`, контраст ≥4.5:1.
- [x] `docs/features/updates.md` (+ `ru/updates.md`, если есть) и spec R11 — что видно во время сборки.
- [x] Test-ы краснеют на mutant-ах: шаг не шлётся на смене; chip без шага; отказ только в console.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный (Windows job-ы — пути сборки на win32).

## Где в коде

- `src/main/update/build.ts`, `src/shared/ipc/update.ts`, `src/main/ipc/update.ts`
- `src/renderer/update/UpdateChip.tsx`, `src/renderer/update/store.ts`, `src/renderer/update/toasts.ts`,
  `src/renderer/settings/UpdatesBlock.tsx`, `src/renderer/palette/commands.ts`
- `test/unit/update-chip.test.tsx`, `test/unit/updates-block.test.tsx`, `test/unit/update-toasts.test.tsx`,
  `test/unit/palette-commands.test.tsx`, `test/contract/update-build.test.ts`, `test/e2e/update-toolbar.spec.ts`
- `docs/features/updates.md`, `.scratch/worfy-update/spec.md`

Не трогать: `src/main/update/restart.ts`, `check.ts`, `state.ts`, `scripts/install-stable.mjs`.

## Итог

Сделано на ветке `worfy-update/16`.

**Решения «Что делаем»** — подтверждено владельцем 2026-11-01: шаг сборки и время с её начала, без процента
download Electron, без toast-а «идёт сборка» (индикатор — chip).

- **Main.** `build.step` (`fetch` | `install` | `electron` | `package`), `build.startedAt`, `build.stepStartedAt` и
  `build.steps` пишет `UpdateBuilder.stepTo` перед spawn-ом шага, каждая смена шлёт `update.changed`
  (`src/main/update/build.ts`). Log main для шагов не читает. Поля необязательные: состояние без них читается
  (contract test). Часы сборки — опция `now`.
- **Отказ `update.install`** — handler падает с причиной: «there is no new version to build» (нет Available update),
  «this update is being built already» (тот же SHA уже собирается). Готовая сборка, как и раньше, отказом не считается.
  Нет git/node/pnpm — по-прежнему упавшая сборка с `missing`; toast «Update failed» теперь называет, чего нет.
- **Перезапуск.** `quit` у `Restarts` идёт через `UpdateService.restartBegan`: snapshot с `restarting: true` уходит в окна
  до `app.quit()`, chip показывает «Restarting…».
- **Окно.** Chip: «Starting update…» от нажатия до первого шага, затем «Updating · N/M <шаг>», кольцо вместо точки,
  tooltip «Building worfy X… m:ss». Settings: та же строка со временем, кнопка «Show log», «Update worfy» до первого
  шага — неактивная «Starting update…». Отказ из chip-а, Command palette и toast-а «Update» — toast «The update did not
  start: <reason>», с «Show log», если сборка оставила log.
- Процент download Electron не делался: main не читает вывод `install.js`, и дешёвого источника процента нет.

Решено без владельца, подтвердить:

- Счёт шагов: `N/3`, пока не пришёл шаг `electron`; с ним — `3/4`, затем `4/4 Building app`. До `electron` сборка не
  знает, будет ли он, поэтому `fetch` и `install` идут как `1/3` и `2/3`. Для этого в состояние добавлено поле `steps`.
- Сборка, начатая, но ещё без шага (main читает окружение login shell), на chip-е тоже «Starting update…».
- Время в tooltip-е тикает раз в секунду, только пока указатель или фокус на chip-е; строка Settings тикает всё время сборки.
- Кольцо заменяет точку на время сборки; меню chip-а во время сборки прежнее.
- «Restarting…» показывается и после начала отката (тот же `quit` у `Restarts`).
- В Settings отказ «Update worfy» по-прежнему строкой под статусом, без toast-а: toast — для chip-а, Command palette и
  toast-а «Update», как в пункте 4.
- Command palette при отказе закрывается и показывает toast, а не строку отказа в себе.
- Стиль кольца — в `src/renderer/shell/shell.css` рядом со стилем точки (файл вне «Где в коде»).
- `docs/features/ru/updates.md` не правился: по ADR-0088 в PR с поведением правится только английская страница.

**Mutant-ы** (каждый ломает новый test; прогон на копии дерева вне репозитория,
`node scripts/vitest-electron.mjs run <файлы>`, exit 1 у всех 23):
M1 шаг не пишется и не шлётся на смене (`stepTo` без `write`) — contract; M2 chip без шага («Updating» без `N/M` и
текста) — unit chip; M3 отказ только в console — unit chip и palette; M4 нет «Starting update…» до ответа main — unit
chip, Settings, toasts; M5 `restarting` не ставится — contract; M6 отказ «being built already» убран — contract; M7 время
не тикает — unit chip и Settings; M8 шаг `electron` не делает счёт 4 — contract; M9 reduced motion не останавливает
кольцо — unit chip; M10 нет «Show log» в Settings — unit Settings; M11 строка Settings без шага — unit Settings;
M12 chip не смотрит на `restarting` — unit chip; M13 отказ из toast-а «Update» молчит — unit toasts; M14 «Update failed»
не называет недостающий инструмент — unit toasts; M15 отказ «there is no new version to build» убран — contract;
M16 шаг `install` не пишется — contract; M17 toast отказа никогда не даёт «Show log» — unit chip; M18 «Starting update…»
не снимается при отказе — unit chip, Settings, toasts, palette; M19 snapshot с `restarting` не уходит в окна до `quit` —
contract; M20 `step` обязателен (старое состояние не читается) — contract; M21 Settings без «Starting update…», пока у
сборки нет шага — unit Settings; M22 шаг `electron` не пишется — contract; M23 chip без «Starting update…» у начатой
сборки без шага — unit chip.

**Снимки** (Playwright, e2e `update-toolbar.spec.ts` и `update-settings.spec.ts` с закоммиченного head после rebase на
`main`; контраст текста chip-а ≥ 4.5:1 проверяет e2e в обеих темах; по самим снимкам: chip 5.4:1 в светлой и 6.1:1 в
тёмной, строка Settings 9.1:1 и 9.2:1): [chip, светлая](../evidence/16-chip-building-light.png),
[chip, тёмная](../evidence/16-chip-building-dark.png), [Settings, светлая](../evidence/16-settings-building-light.png),
[Settings, тёмная](../evidence/16-settings-building-dark.png).

**e2e.** `update-toolbar.spec.ts` и `update-settings.spec.ts` зелёные с закоммиченного head (3 из 3), и вместе с
`update-toasts.spec.ts` (его «Update» теперь идёт через `installUpdate`) — 15 из 15 при `--repeat-each=3`. Упавший
прогон этих spec-ов в log-ах и транскрипте прошлой сессии не нашёлся: оба её прогона e2e тоже зелёные. Сбой не
повторился ни разу из 4 прогонов: признаков ошибки кода нет, вероятная причина — окружение (прошлую сессию прервал
перезапуск worfy); точная причина не установлена.
