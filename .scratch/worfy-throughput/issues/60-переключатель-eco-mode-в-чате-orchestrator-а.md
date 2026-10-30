# 60 — Переключатель «Eco mode» в чате Orchestrator-а

Type: task
Status: claimed 2026-10-30T19:07Z
Blocked by: —
Source: просьба владельца 2026-10-30 («нужно иметь возможность переключать эко/фулл прямо в чате оркестратора в
виде свитча») и его ответы Q12–Q15 в тот же день; [Ticket 42](42-preset-profile-по-плану-подписки.md) (готовая
настройка Pro, `src/shared/agent/plan-preset.ts`), раздел «Решения владельца 2026-10-28: меньше token-ов на Ticket»

## Что происходит

- Eco задают поля Profile-а проекта: `workflow.agents` (`eco` | `full`) и `agents` (модель и effort ролей
  implementer, reviewer, scout, verifier). Пишет их скрипт Harness `bin/profile-set --field` (через
  `src/main/ipc/plan-preset.ts`).
- В интерфейсе их ставит только кнопка Apply в Settings → Plan, и только на плане Pro (`PLAN_PRESETS`,
  `plan-preset.ts:52`). На Max включить eco можно лишь командой в терминале.
- Нижняя строка поля ввода Session-а — `src/renderer/session/composer/` (`Pickers.tsx`: Model, Effort,
  Permissions; `index.ts` — список элементов строки).

## Что делаем (решения владельца 2026-10-30)

1. В нижней строке поля ввода **только Orchestrator-а** — переключатель on/off с иконками вместо текста и
   короткой подписью «Eco mode»; справа от Permissions, в стиле остальных элементов строки. Tooltip: что делает
   eco (меньше агентов на Ticket, Sonnet и effort medium для ролей агентов) и «applies to the next Ticket».
   Работает на любом плане.
2. **On** пишет в Profile проекта весь набор eco без поля бюджета: `workflow.agents: "eco"` и `agents` — Sonnet,
   effort medium для четырёх ролей (те же значения, что `PLAN_PRESETS.pro.profile`, без копии констант).
3. **Off** удаляет оба поля (`workflow.agents` и `agents`): проект возвращается к умолчанию Harness. Прежние
   модели ролей не запоминаются (решение владельца Q12).
4. Без поля `workflow.agents` переключатель показывает off; `eco` в поле — on. Значение `agents`, отличное от
   набора eco, при `workflow.agents: eco` — всё равно on (переключатель смотрит на `workflow.agents`).
5. Действует на весь проект (Ticket-ы этого Orchestrator-а и Autopilot проекта) со следующей раздачи; идущие
   Ticket-ы не меняются.
6. Запись — через `profile-set` с `--expect <fingerprint>`; расхождение fingerprint-а (Profile поменяли
   снаружи) — перечитать и показать текущее состояние, без записи. Ошибка записи — toast с причиной,
   переключатель возвращается.
7. Проект на другой Machine (Linked machine) или только для чтения — переключатель недоступен с tooltip-ом,
   как остальные элементы строки (`useReadOnly`).

Решено без владельца, подтвердить: дневной бюджет Autopilot (часть готовой настройки Pro) переключатель не
трогает — это настройка Machine, а не проекта; иконки — лист (on) и молния (off), из тех же SVG, что
остальные иконки строки, без новой библиотеки.

## Готово, когда

- [ ] Переключатель есть только у Orchestrator-а; в обычной Session его нет.
- [ ] On → в `profile.json` проекта `workflow.agents: "eco"` и `agents` с Sonnet/medium у четырёх ролей;
      `bin/profile -C <repo> --field workflow.agents` печатает `eco`.
- [ ] Off → обоих полей нет (`profile --field workflow.agents` — exit 4).
- [ ] Profile поменяли снаружи между чтением и кликом — записи нет, показано свежее состояние.
- [ ] Только чтение / проект другой Machine — переключатель недоступен.
- [ ] Снимки строки в светлой и тёмной теме (on и off).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; ci-ok зелёный.

## Тесты

- Contract: IPC записи через настоящий `harness/bin/profile-set` во временной `HARNESS_HOME`: on, off,
  fingerprint устарел, ошибка записи.
- Unit (renderer): переключатель только у Orchestrator-а, состояние по `workflow.agents`, недоступность.
- E2e: клик on/off в Orchestrator-е над временной папкой данных, проверка `profile.json`.
- Сначала падающий: e2e — переключателя нет.

## Где в коде

- `src/renderer/session/composer/` (новый элемент строки; `index.ts` — порядок)
- `src/main/ipc/plan-preset.ts` или новый `src/main/ipc/eco-mode.ts` (запись через `profile-set`)
- `src/shared/ipc/` (канал), `src/shared/agent/plan-preset.ts` (только переиспользовать набор Pro)
- test-ы: `test/contract/eco-mode.test.ts`, `test/unit/eco-mode-switch.test.tsx`, `test/e2e/eco-mode.spec.ts` (новые)

Только читать: `harness/bin/profile-set`, `src/renderer/settings/PlanSection.tsx`.
