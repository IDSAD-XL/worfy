# 37 — Orchestrator и Autopilot на Codex

Type: task
Status: done 2026-11-04T02:25Z
PR: #1318
Blocked by: 33, 35, 45
Source: [spec.md](../spec.md), «Цель и что видит пользователь» (второй выпуск), «Решено без владельца», п. 5; решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); решение 09 ([09-limits-и-autopilot-по-vendor.md](09-limits-и-autopilot-по-vendor.md))

## Что происходит

- Orchestrator — Session Claude Code (`src/main/agent/orchestrator.ts`, `src/main/agent/app-orchestrators.ts`).
- Autopilot ведёт Run через unattended Session: `bypassPermissions`, отказ диалогов (`refused_dialog`,
  `src/shared/agent/events.ts:116-131`), Wave — в Session Orchestrator-а (`src/main/autopilot/run.ts`).

## Что делаем

Run на Codex начинается только с Harness, чьи гарантии доказаны parity suite (Ticket 45; решение владельца Q5).

1. Vendor Orchestrator-а — `defaultVendor` Project-а; смена Vendor-а Orchestrator-а — в Settings Project-а, вступает
   со следующего старта Orchestrator-а.
2. Unattended Session Codex: preset «Full access» (`danger-full-access` + `never`); approval, который всё же пришёл, —
   ответ `decline` и событие `refused_dialog`, как у Claude.
3. Autopilot ведёт Wave через SessionHandle Orchestrator-а любого Vendor-а; проверок имени Vendor-а в `run.ts` нет.
4. Journal: `run-started` пишет `vendor` (новое необязательное поле); без него — `claude`.

Глубина review — `high` (driver Codex в Autopilot).

## Готово, когда

- [x] Contract test (фейк Codex): Run на Orchestrator-е Codex проходит Wave сценария; approval в unattended —
      `decline` и строка `refused-dialog` в Journal.
- [x] Test-ы Autopilot на Claude проходят без правок ожиданий; все unit и contract test-ы модуля Autopilot — exit 0.
- [x] `pnpm typecheck`, `pnpm lint` — exit 0.

## Где в коде

- `src/main/agent/orchestrator.ts`, `src/main/agent/app-orchestrators.ts`
- `src/main/vendors/codex/session.ts` — unattended
- `src/main/autopilot/run.ts`
- `src/shared/autopilot/journal.ts` — `run-started`
- Test-ы: `test/unit/autopilot-run.test.ts`, `test/contract/codex-orchestrator.test.ts` (новый)

## Итог

- Vendor Orchestrator-а — `defaultVendor` Project-а (`src/main/agent/app-orchestrators.ts`, dep `vendor`); читается при
  старте Orchestrator-а — при открытии и на «New conversation» — и держится для всех relaunch-ей (Autopilot, give-back),
  так что unattended Session и возврат продолжают thread того же Vendor-а. `data` Node-а получает `vendor` сохранённой
  Session; без него — Claude Code (`src/shared/ipc/orchestrator.ts`).
- Unattended Session Codex: `bypassPermissions` → preset «Full access» (`danger-full-access` + `never`) и `decline` на
  approval с `refused_dialog` уже были в driver-е (Ticket-ы 20, 25); `src/main/vendors/codex/session.ts` не менялся.
  Contract test проверяет это на всём пути Autopilot: `test/contract/codex-orchestrator.test.ts`, сценарий
  `test/fixtures/codex-scripts/autopilot-wave.jsonl`.
- `run.ts` проверок имени Vendor-а не имеет; `run-started` пишет `vendor` из вида Orchestrator-а (новое необязательное
  поле Journal, неизвестное значение читается как отсутствующее).
- Settings Project-а: подсказка у «Default vendor» говорит, что Orchestrator работает на нём со следующего старта.
  Снимки: [светлая](../evidence/37/37-orchestrator-vendor-light.png), [тёмная](../evidence/37/37-orchestrator-vendor-dark.png).
- Takeover остановленного Run-а (worfy-polish 50) — код общий для обоих Vendor-ов, но у Codex он не наступает: driver Codex
  не сообщает background task-ов, а старт во время хода отказывается (`ORCHESTRATOR_IN_TURN`) у обоих Vendor-ов.

Решено без владельца, подтверждено владельцем 2026-11-05 (шестой пункт позже изменён Ticket-ом 39):

1. «Следующий старт Orchestrator-а» — открытие Orchestrator-а (запуск worfy) и «New conversation»; во время работы
   Orchestrator Vendor не меняет, Autopilot тоже.
2. Сохранённая Session другого Vendor-а не продолжается: начинается новая на Vendor-е Project-а, старая остаётся в
   истории. Выбранные model и effort Node-а при смене Vendor-а сбрасываются на «Default» (они были другого Vendor-а);
   permission mode переходит в свой эквивалент на новом Vendor-е (`settingsFor` обоих Vendor-ов: Bypass permissions ↔
   Full access, Accept edits ↔ Auto, Ask before tools ↔ Read only, Plan only → Read only).
3. `vendor` в `data` Node-а Orchestrator-а: без него нельзя понять, чью Session продолжать. Решение — ADR-0095,
   поправка к ADR-0010.
4. Node Orchestrator-а на Codex после старта не читает транскрипт: модель и блок состояния — с первого ответа
   (`shortcut:` в `app-orchestrators.ts`). Пропавший thread находит сам resume (`no rollout found for thread id` →
   новая Session).
5. При смене Vendor-а Node держит старые `sessionId`, стоимость и `vendor` до первого `init` Session нового Vendor-а:
   старт, который не удался, не теряет старую Session, и возврат на прежний Vendor её продолжает.
6. Run Autopilot-а на Codex отказывается до Ticket-а 39: у Codex `harness: false`, причина — `unsupported.harness`
   (Harness установлен, но worfy пока не проверяет, что Codex выполняет его hook-и). Отказ — в
   `Orchestrators.unattendedRefusal` (Vendor открытого Orchestrator-а, иначе Project-а), его зовут `startCheck` Run-а и
   `setUnattended(true)`; capabilities, которые не прочитались, тоже отказывают.
7. Отказ смены permission mode у unattended Session говорит словами её Vendor-а: у Codex — «Full access», без
   упоминания Claude Code.

### Раунд 1

Ревью (high) нашло: Run на Codex стартовал при `harness: false`; permission mode при смене Vendor-а не переводился
обратно на Claude Code; `sessionId` и стоимость сбрасывались до того, как новый Vendor стартовал; проверка
`vendor !== 'claude'` в чтении транскрипта; нет test-а на пропавший thread Codex; отказ смены mode у Codex называл
Claude Code; ADR-0010 без поправки. Исправлено:

- `Orchestrators.unattendedRefusal` + `capabilities` в deps (`src/main/agent/orchestrator.ts`,
  `app-orchestrators.ts`), его зовут `run.ts` (`ownChecks`) и `ipc/autopilot.ts`; текст `unsupported.harness` у Codex
  обновлён (`src/main/vendors/codex/capabilities.ts`). Сценарий Wave в test-е включает `harness` явно, с комментарием,
  что Ticket 39 заменит это настоящей проверкой.
- `settingsFor` у Claude Code (`claudeSettings` в `src/main/vendors/claude/options.ts`).
- `leaveSession`: при смене Vendor-а Node не трогается до `init`; `init` пишет `sessionId`, `costUsd: 0` и `vendor`.
- Чтение транскрипта — запись по Vendor-у (`Record<VendorId, reader>`), без сравнения имени.
- `settingsChangeRefusal` получает настройку, в которой Vendor держит unattended Session.
- ADR-0010 — раздел Amendments, ADR-0095 — фраза о слиянии `patchData`.
- Test-ы: `test/contract/codex-orchestrator.test.ts` (отказ Run-а на Codex, круг permission mode, неудачный старт
  Codex и возврат на Claude Code, пропавший thread, отказ mode словами Codex), `test/contract/app-orchestrators.test.ts`
  (настоящая сборка `sharedOrchestrators`: `defaultVendor` из `settings.json`, транскрипт Claude Code, отказ Codex).
  Каждый test краснеет на своём mutant-е.
