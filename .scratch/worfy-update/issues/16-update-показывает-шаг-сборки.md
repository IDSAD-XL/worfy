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

- [ ] Unit: chip в `building` показывает шаг и `N/M` без наведения; tooltip — время; reduced motion без анимации;
      «Starting update…» до первого `update.changed`; отказ → toast; `Restarting…`.
- [ ] Unit Settings: строка шага, время, `Show log`.
- [ ] Contract `test/contract/update-build.test.ts`: шаги идут `fetch → install → (electron) → package`, каждая смена шлёт
      `update.changed`; старое состояние без `step` читается.
- [ ] e2e `test/e2e/update-toolbar.spec.ts` (gated `WORFY_UPDATE_BUILD`): после клика chip сразу меняется, видны шаги
      по очереди, затем «Restart now».
- [ ] Снимки chip-а и Settings во время сборки в обеих темах в `.scratch/worfy-update/evidence/16-*.png`, контраст ≥4.5:1.
- [ ] `docs/features/updates.md` (+ `ru/updates.md`, если есть) и spec R11 — что видно во время сборки.
- [ ] Test-ы краснеют на mutant-ах: шаг не шлётся на смене; chip без шага; отказ только в console.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; CI PR зелёный (Windows job-ы — пути сборки на win32).

## Где в коде

- `src/main/update/build.ts`, `src/shared/ipc/update.ts`, `src/main/ipc/update.ts`
- `src/renderer/update/UpdateChip.tsx`, `src/renderer/update/store.ts`, `src/renderer/update/toasts.ts`,
  `src/renderer/settings/UpdatesBlock.tsx`, `src/renderer/palette/commands.ts`
- `test/unit/update-chip.test.tsx`, `test/unit/updates-block.test.tsx`, `test/unit/update-toasts.test.tsx`,
  `test/unit/palette-commands.test.tsx`, `test/contract/update-build.test.ts`, `test/e2e/update-toolbar.spec.ts`
- `docs/features/updates.md`, `.scratch/worfy-update/spec.md`

Не трогать: `src/main/update/restart.ts`, `check.ts`, `state.ts`, `scripts/install-stable.mjs`.
