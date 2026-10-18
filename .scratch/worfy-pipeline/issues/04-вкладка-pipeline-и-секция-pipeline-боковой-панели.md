# 04 — Вкладка Pipeline (доска активного Project-а) и секция Pipeline боковой панели

Type: task
Status: claimed 2026-10-18T01:14Z
Blocked by: 03
Source: решение владельца 2026-10-17, grilling о Pipeline, пункты 1, 2 ([spec.md](../spec.md),
«Решения владельца»); [ADR-0067](../../../docs/adr/0067-pipeline-in-profile-and-sha-bound-agent-marks.md).

## Что происходит

- **Вид окна — два:** `ShellView = 'canvas' | 'session'` (`src/renderer/shell/Toolbar.tsx:11`),
  переключатель — `viewOptions` (`:19-41`). `AppShell` получает содержимое видов свойствами `canvas` и
  `session` (`src/renderer/shell/AppShell.tsx:13-22`, `:55`); вид задаёт `src/renderer/main.tsx`.
- **Секции боковой панели** — файлы `src/renderer/shell/sidebar/<Name>Section.tsx` с `order`,
  подхватываются сами (`src/renderer/shell/Sidebar.tsx:3-8`), рамка — `SidebarSection.tsx`. Пример —
  `EpicsSection.tsx` (Epic-и активного Project-а).
- После Ticket-а 03 Stage каждого Ticket-а приходит доменом `pipeline` (`pipeline.get`,
  `pipeline.changed`), хук — `src/renderer/pipeline/usePipeline.ts`.

## Что делаем

1. **Третья вкладка `Pipeline`** в `viewOptions` после Canvas и Session; `ShellView` +=
   `'pipeline'`; `AppShell` получает свойство `pipeline` с содержимым вида.
2. **Доска `src/renderer/pipeline/PipelineBoard.tsx`** — активный Project:
   - колонки — Stage его Pipeline по порядку, с `label` из Profile-а;
   - карточка — Ticket: `<epic> NN`, заголовок, «кого ждёт» (`owner`, `team`, `agent`, имя
     Machine), пометки `blocked` с причиной, `rework`, подпись Stage (`failing`, `gate running`,
     `waiting for gate`);
   - Queued — открытые и не начатые Ticket-ы; Done — свёрнут в счётчик, клик разворачивает;
   - клик по карточке — Card Ticket-а на Canvas (как фокус Epic-а из `EpicsSection`);
   - обновление живое: событие `pipeline.changed`, без кнопки обновления.
3. **Секция `src/renderer/shell/sidebar/PipelineSection.tsx`** — все Project-ы: Ticket-ы в работе
   (не Queued, не Done) с чипом Stage и «кого ждёт»; клик — вкладка Pipeline этого Project-а.
   Сворачивается, как другие секции (`SidebarSection`); пустая — строка «Nothing in work».
4. Надписи интерфейса — английские. Stage не хранится в renderer дольше окна (ADR-0002).

Не входит: выделение застрявших (06), stepper на Card (05).

## Готово, когда

- [ ] `pnpm test test/unit/pipeline-board.test.tsx` — exit 0: колонки по Pipeline worfy и Atakama из
      spec-а; Done свёрнут в счётчик; `blocked`, `rework`, «кого ждёт» видны; секция показывает только
      Ticket-ы в работе.
- [ ] `pnpm test:e2e test/e2e/pipeline.spec.ts` — exit 0: переключатель Canvas / Session / Pipeline;
      правка файла Ticket-а (`claim`) двигает карточку из Queued в Implementing без перезагрузки; клик по
      строке секции открывает доску.
- [ ] `pnpm test:e2e test/e2e/sidebar-sections.spec.ts` — exit 0 (новая секция не ломает порядок).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.
- [ ] (вручную) Stable copy после мержа: доска worfy во время Wave — снимок в `../evidence/04-доска.png`.

## Тесты

Сначала падающий `test/unit/pipeline-board.test.tsx` на снимке `pipeline.get` из фикстуры. e2e — с
fake-агентом (`WORFY_AGENT=fake`, `test/e2e/helpers.ts`) и stub-ом `gh`; `test/e2e/helpers.ts` этот
Ticket не правит.

## Где в коде

- `src/renderer/shell/Toolbar.tsx`
- `src/renderer/shell/AppShell.tsx`
- `src/renderer/main.tsx`
- `src/renderer/pipeline/PipelineBoard.tsx` (новый)
- `src/renderer/pipeline/pipeline.css` (новый)
- `src/renderer/shell/sidebar/PipelineSection.tsx` (новый)
- `test/unit/pipeline-board.test.tsx` (новый)
- `test/e2e/pipeline.spec.ts` (новый)

## Итог

Заполняется при закрытии.
