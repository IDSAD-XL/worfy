# 24 — Выбор Vendor-а и значок

Type: task
Status: open
Blocked by: 17, 18, 20, 21, 23
Source: [spec.md](../spec.md), «Цель и что видит пользователь», п. 1–2, «Решено без владельца», п. 7, 8, 10; решение 07 ([07-что-получает-codex.md](07-что-получает-codex.md)); Ticket 01 ([01-destination-vendor-масштаб.md](01-destination-vendor-масштаб.md), п. 3)

## Что происходит

- «New session» — на Canvas (`src/renderer/canvas/nodes/SessionNode.tsx`), в rail-е (`src/renderer/session/rail/`)
  и в боковой панели (`src/renderer/shell/sidebar/SessionsSection.tsx`).
- Подпись сообщений агента — `'claude'` или `'orch'` (`src/renderer/session/SessionView.tsx:210`).
- После Ticket-а 23 у Session и Project есть Vendor в данных, но выбрать его негде.

## Что делаем

1. «New session»: выбор Vendor-а — Claude Code или Codex — с Vendor-ом по умолчанию Project-а первым. Vendor без
   входа — недоступен с tooltip «Sign in to Codex in Settings → Vendors» (вход — Ticket 29).
2. Settings Project-а → Sessions: «Default vendor».
3. `VendorBadge` — текстовая подпись Vendor-а с нейтральным значком, без логотипов Vendor-ов (решение владельца
   Q10) на Node Session, в rail-е, в шапке Session view; подпись сообщений агента —
   имя Vendor-а (Orchestrator — по-прежнему `orch`).
4. Подписи и значки — из `src/shared/vendors/vendor.ts`; проверок имени Vendor-а в renderer нет.
5. Снимки в обеих темах — `.scratch/worfy-multi-vendor/evidence/24/`.

Из ревью Wave 7 (low; решено без владельца, подтвердить):

6. «Ship ticket» зовёт `sessions.create`, который берёт `defaultVendor` Project-а и обходит отказ без входа из `open`
   (`src/main/actions/launch.ts:197`, `src/main/agent/node-sessions.ts:182`): с выбором «Default vendor» Codex skill
   Harness уйдёт в Codex раньше Ticket-ов 35/36. Закрепить «Ship ticket» за `claude` или пропустить его через
   `vendorRefusal` (ревью PR #1267, Ticket 23).
7. Save настроек без `defaultVendor` сохраняет сохранённое значение (`src/main/projects/settings.ts:44`): «Default
   vendor» можно заменить, но не сбросить — выбору нужен сброс (ревью PR #1267, Ticket 23).
8. С двумя разделами Limits ничто видимое не говорит, который из них Codex — только tooltip и доступное имя: короткая
   видимая метка Vendor-а (`VendorBadge`) в панели Limits (`src/renderer/shell/toolbar/LimitsMeter.tsx`), не ломая
   ширину заголовка Project-а в окне 1280 px (ревью PR #1266, Ticket 26).

## Готово, когда

- [ ] e2e (фейки Claude и Codex): «New session» → Codex — Node со значком Codex; Vendor по умолчанию Project-а
      выбран первым; без входа Codex недоступен с tooltip.
- [ ] Unit test: `VendorBadge` — текст и нейтральный значок, без логотипа.
- [ ] Unit test: подпись сообщений агента — имя Vendor-а Session.
- [ ] Снимки обеих тем в `evidence/24/`.
- [ ] `pnpm typecheck`, `pnpm lint`, unit test-ы renderer-а Session и e2e spec — exit 0.

## Где в коде

- `src/renderer/session/SessionView.tsx` — `:210`
- `src/renderer/canvas/nodes/SessionNode.tsx`
- `src/renderer/session/rail/`, `src/renderer/shell/sidebar/SessionsSection.tsx`
- `src/renderer/session/VendorBadge.tsx`, `src/renderer/session/NewSessionVendor.tsx` (новые)
- `src/renderer/settings/SessionsSection.tsx`
- `test/e2e/vendor-picker.spec.ts` (новый), `scripts/e2e-specs.table.json`
- `test/unit/session-view.test.tsx`
- Из ревью Wave 7 (п. 6–8): `src/main/actions/launch.ts`, `src/main/agent/node-sessions.ts`,
  `src/main/projects/settings.ts`, `src/renderer/shell/toolbar/LimitsMeter.tsx`, `test/e2e/limits-vendors.spec.ts`
