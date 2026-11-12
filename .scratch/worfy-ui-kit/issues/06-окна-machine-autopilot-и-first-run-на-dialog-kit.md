# 06 — Окна Machine, Autopilot и First run на Dialog kit

Type: task
Status: done 2026-11-12T22:29Z
PR: #1839
Branch: worfy-ui-kit/06
Blocked by: 04
Source: [spec.md](../spec.md), «Ticket-ы», строка 06; «Решения по реализации» (остальные модальные окна); истории 1, 2, 9;
заметка темы `docs/product/ui-overhaul/notes/inventory-overlays.md`, разделы 1.1 и 10.1

## Что происходит

- Change address и Remove machine делят `MachineDialogFrame` (`machines/ChangeAddressDialog.tsx:30-82`,
  `machines/MachineDialogs.tsx`, `machines/machine-dialogs.ts`): свой focus trap, фокус не возвращается.
- Link a machine — `machines/LinkMachineDialog.tsx`: focus trap нет, возврата нет.
- Start Autopilot и Start now? (`autopilot/StartAutopilotModal.tsx`, `autopilot/StartNowModal.tsx`): свои focus trap и
  capture-listener-ы на window.
- First run — `shell/FirstRun.tsx`: focus trap нет, возврата нет; Esc не закрывает во время переноса.

## Что делаем

1. Пять окон и `MachineDialogFrame` переходят на Dialog kit (Ticket 04). Свои focus trap, listener-ы `focusin` и
   capture-listener-ы `keydown` удаляются.
2. Слой из шкалы вместо `MACHINE_DIALOG_LAYER` и z-index рамки `.w-apstart` (`autopilot/autopilot-modal.css:23`).
3. Правила окон сохраняются: First run не закрывается по Esc во время переноса; радио и режимы окна Start Autopilot
   не трогаются (их переносит Ticket 14).
4. ⌘↩ окна Start Autopilot (`autopilot/StartAutopilotModal.tsx:18`, `:406`) погасит guard клавиш с ⌘/Ctrl внутри окна
   kit (`theme/kit/Dialog.tsx`, функция `guardKeys`): он останавливает такие клавиши в capture на window, чтобы до них
   не дошли shortcut-ы приложения. Dialog kit получает opt-in для клавиш-модификаторов (prop окна: какие сочетания
   окно берёт само), и Start Autopilot им пользуется. Test: ⌘↩ в окне запускает Autopilot, ⌘K в нём не открывает
   Command palette.

## Готово, когда

- [ ] Unit test-ы окон: Tab не уходит из окна; после закрытия фокус на кнопке, которая окно открыла; First run во время
      переноса Esc не закрывает.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/first-run-dialog.test.tsx test/unit/machines-section.test.tsx test/unit/start-autopilot-modal.test.tsx test/unit/start-now-modal.test.tsx test/unit/settings-health.test.tsx test/unit/kit-dialog.test.tsx` exit 0 · mac - · 2833de80af0b7ebdd1325e04c9bbbfb74c1447e2
- [ ] Существующие unit test-ы и e2e `linked-machines.spec.ts`, `autopilot-start-modal.spec.ts`, `first-run.spec.ts`
      зелёные без правок ролей и `data-testid`.
  - evidence: ci-check pass · CI green on PR #1839 (ci-ok, e2e jobs included) · mac - · 197ffc5095477f78176a8d38ee85ec790c7884a2
- [ ] Своих focus trap в этих окнах нет; `MACHINE_DIALOG_LAYER` нет.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/unit/layers.test.tsx` exit 0 · mac - · 2833de80af0b7ebdd1325e04c9bbbfb74c1447e2
- [ ] Правка вида, если она есть, названа в PR отдельной строкой.
  - evidence: commit pass · Machine, Autopilot and First run windows on the kit's Dialog (worfy-ui-kit 06) · - - · 2833de80af0b7ebdd1325e04c9bbbfb74c1447e2
- [ ] lint, typecheck, test-ы модуля и gate fast — exit 0.
  - evidence: gate pass · `gate fast` exit 0 · mac - · 2833de80af0b7ebdd1325e04c9bbbfb74c1447e2

## Где в коде

- `src/renderer/machines/ChangeAddressDialog.tsx`
- `src/renderer/machines/MachineDialogs.tsx`
- `src/renderer/machines/machine-dialogs.ts`
- `src/renderer/machines/LinkMachineDialog.tsx`
- `src/renderer/autopilot/StartAutopilotModal.tsx`
- `src/renderer/autopilot/StartNowModal.tsx`
- `src/renderer/autopilot/autopilot-modal.css`
- `src/renderer/shell/FirstRun.tsx`
- `test/unit/start-autopilot-modal.test.tsx`
- `test/unit/link-machine-dialog-pause.test.tsx`
- `test/e2e/linked-machines.spec.ts`
- `test/e2e/autopilot-start-modal.spec.ts`
- `test/e2e/first-run.spec.ts`

## Вне скоупа

- Свои radio и segmented control окна Start Autopilot: Ticket 14.
