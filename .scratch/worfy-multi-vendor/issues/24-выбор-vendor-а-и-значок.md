# 24 — Выбор Vendor-а и значок

Type: task
Status: done 2026-11-03T05:28Z
PR: #1274
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

Из ревью Wave 7 (low; решено без владельца, подтверждено владельцем 2026-11-03):

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

## Итог

- «New session» в боковой панели открывает список «New session on» (`src/renderer/session/NewSessionVendor.tsx`): Vendor-ы
  в порядке, который даёт main (`sessions.vendors`, `NodeSessions.vendors`), Vendor по умолчанию Project-а первым, с
  пометкой `default`. Vendor без входа остаётся в списке неактивным, его tooltip — причина отказа main:
  `Sign in to Codex in Settings → Vendors` (`signInHint` в `src/shared/vendors/vendor.ts`; та же строка — отказ
  `sessions.new`). Машина без канала `sessions.vendors` (Linked machine старой сборки) получает New session на Vendor-е
  по умолчанию, как до списка. «New session» в Command palette по-прежнему берёт Vendor по умолчанию, без выбора; если это Codex без входа, main
  отказывает с `Sign in to Codex in Settings → Vendors`. Расхождение low, тикетом не становится (решение владельца
  2026-11-03).
- `VendorBadge` (`src/renderer/session/VendorBadge.tsx`): нейтральный значок (круг — Claude Code, скруглённый квадрат —
  Codex, без логотипов) и текст. Показан: на Node Session — в строке папки, коротко (`Claude`, `Codex`, полное имя в
  tooltip); в шапке Session view после заголовка; в первом блоке rail-а «Vendor» (`rail/VendorRail.tsx`); в списке
  «New session»; в панели Limits у раздела Codex. Подпись сообщений агента — `claude` / `codex`, у Orchestrator — `orch`.
  Подписи, значки и Vendor по умолчанию — из `src/shared/vendors/vendor.ts` (`vendorLabel`, `vendorIcon`,
  `UNNAMED_VENDOR`); проверок имени Vendor-а в renderer нет.
- «Default vendor» — в диалоге «Project settings…» (`src/renderer/shell/ProjectSettings.tsx`), а не в Settings → Sessions:
  раздел Settings → Sessions — настройки Machine, а `defaultVendor` хранится в `settings.json` Project-а, которые правит
  этот диалог (решено без владельца, подтверждено владельцем 2026-11-03).
- Пункт 6 (решено без владельца, подтверждено владельцем 2026-11-03): «Ship ticket» закреплён за `claude` (`SHIP_TICKET_VENDOR` в
  `src/shared/projects/action-templates.ts`, `src/main/actions/launch.ts`), а не пропущен через `vendorRefusal`. Это
  безопаснее: skills Harness до Ticket-ов 35/36 работают только под Claude Code, а `vendorRefusal` пропустил бы в Codex
  любого, кто в него вошёл. Диалог настроек говорит это под полем.
- Пункт 7: «None (Claude Code)» в «Default vendor» сбрасывает значение — `projects.settings.set` принимает
  `defaultVendor: null` и убирает поле из файла; отсутствие поля, как раньше, сохраняет сохранённое (Linked machine старой
  сборки).
- Пункт 8 (решено без владельца, подтверждено владельцем 2026-11-03): видимая метка — только у разделов после первого (`Codex`) и у раздела без
  полос; раздел Claude, первый и всегда присутствующий, остаётся как в макете F, имя — tooltip. Метки у обоих разделов
  сжимали заголовок Project-а в окне 1280 px до 0 px, одна метка Codex — до 56 из 102 px (замер e2e). Поэтому полосы
  компактной панели сужены с 80 до 66 px (`src/renderer/limits/LimitBar.tsx`): `Sat 00:40` и `weekly 40%` целые,
  заголовок `worfy — auction` и строка ветки целые (`test/e2e/limits-vendors.spec.ts`).
- e2e `test/e2e/vendor-picker.spec.ts`: порядок и «Default vendor» с его сбросом (фейк `account-plus`); выбор Codex —
  Node, шапка, rail и подпись `codex` (фейк `turn`: один сценарий играет все процессы фейка, так что проверка входа
  падает и, по правилу `signInRefusal`, ничего не запрещает); без `CODEX_HOME` Codex неактивен с tooltip. Остальные spec-и,
  которые жмут «New session», идут через `newSessionOn` в `test/e2e/helpers.ts`.
- Снимки обеих тем: [список](../evidence/24/24-vendor-picker-light.png) ([тёмная](../evidence/24/24-vendor-picker-dark.png)),
  [без входа](../evidence/24/24-vendor-picker-signed-out-light.png) ([тёмная](../evidence/24/24-vendor-picker-signed-out-dark.png)),
  [Node](../evidence/24/24-vendor-node-light.png) ([тёмная](../evidence/24/24-vendor-node-dark.png)),
  [Session view](../evidence/24/24-vendor-session-view-light.png) ([тёмная](../evidence/24/24-vendor-session-view-dark.png)),
  [Limits](../evidence/24/24-limits-light.png) ([тёмная](../evidence/24/24-limits-dark.png)).
