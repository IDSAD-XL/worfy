# 04 — Вердикт Windows без ручного разбора: порядок Ticket-ов `worfy-windows` 53, 51, 14 и запись worfy в реестре Gate на ПК

Type: task
Status: done 2026-10-29T14:40Z
Blocked by: —
Source: [spec.md](../spec.md), решение владельца 2026-10-16, пункт 1; замер: `worfy-polish` 13 ждал
9 h (gate full на Windows-ПК); [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md),
пункт 2 и «Последствия»; Epic [worfy-windows](../../worfy-windows/spec.md).

## Что происходит

- **Платформенный PR вливается после gate full на Windows-ПК** (ADR-0056, пункт 2,
  `docs/adr/0056-windows-checks-and-two-sessions.md:38-43`). Пока test-ы под Windows не починены, PR
  вливается, если падения на ПК совпадают со списком известных (`:73-77`). Это ручной разбор: Session
  на ПК сравнивает списки, Orchestrator на Mac его перепроверяет. Сегодня так ждёт `worfy-polish` 19
  (PR #365).
- **Gate full на Windows сейчас не запускает ни одного e2e.** Четыре файла `test/e2e` при загрузке
  модуля вызывают `/bin/sh`, Playwright падает на загрузке всего набора — `worfy-windows` 53
  (`.scratch/worfy-windows/issues/53-e2e-не-загружаются-на-windows-из-за-bin-sh.md`, влит docs-PR #380).
- **Очистка `%TEMP%` при старте vitest идёт через junction** и опустошает папку за ним (например,
  `node_modules` соседнего worktree) — `worfy-windows` 51 (тоже влит PR #380; рядом 52 — пропадающие
  пакеты в `node_modules` соседних worktree).
- **Gate full на Windows как правило** — `worfy-windows` 14 («Gate full на Windows: unit- и
  e2e-test-ы»), `Status: open`, блокеры 03, 08, 10, 11, 12 все `done`. Идёт срезами (его «Итог»).
- **У ПК нет записи worfy в реестре Gate.** Gate ищет реестр: `CLAUDE_GATE_CONFIG`, иначе
  `$HARNESS_HOME/gate/config.json` (`harness/hooks/gate-resolve.mjs:24-26`). На ПК нет Harness и
  Profile-а worfy (evidence `worfy-windows` 01, `.scratch/worfy-windows/evidence/01-факты-windows.md:733`),
  и Session на ПК гоняла gate с временным реестром через `CLAUDE_GATE_CONFIG`. Запись в реестре пишет
  `harness/bin/project-connect` при подключении Project-а (`:391-396`: дописывает записи черновика в
  `$HARNESS_HOME/gate/config.json`). На Windows его запускает «Add project» — `worfy-windows` 30, open,
  `Blocked by: 05, 13`. Отдельный код для реестра не нужен — нужен порядок.

## Что делаем

Новых Ticket-ов `worfy-windows` этот Ticket не заводит и их текст не меняет. Он задаёт порядок и один
временный шаг; ведёт Session Orchestrator-а на Mac вместе с Session на Windows-ПК.

1. **Порядок для Session на ПК** (по одному, общих файлов у них может не быть, но все краснят gate
   full):
   1. `worfy-windows` 53 — e2e загружаются на Windows. Без него gate full на ПК не гоняет e2e вовсе.
   2. `worfy-windows` 51 — очистка `%TEMP%` не идёт через junction. Без него прогон в одном worktree
      портит соседние, и gate full краснеет не по коду.
   3. `worfy-windows` 14 — оставшиеся срезы, до зелёного gate full на ПК на main.
   4. `worfy-windows` 30 — «Add project» на Windows (когда закрыты его блокеры 05 и 13): запись в
      реестре Gate создаёт `project-connect`.
2. **Временный шаг до `worfy-windows` 30 (вручную, Session на ПК, слово владельца в её чате).** Один раз
   записать `%USERPROFILE%\.claude\worfy-harness\gate\config.json` с записью `worfy` — копией записи
   Mac (`root.fast`, `root.full`, `root_if`, `pm: pnpm`), `match` — путь репозитория на ПК. Через
   PowerShell tool Session-а: Bash tool на ПК пишет в частную копию профиля (память Orchestrator-а о
   ПК). После этого gate на ПК идёт без `CLAUDE_GATE_CONFIG`. Когда `worfy-windows` 30 сделан —
   запись остаётся (project-connect откажет с `conflict` на тот же `match`, `:302-307`): подключение
   worfy на ПК идёт после удаления временной записи, это пишется в «Итог» 30.
3. **Как Orchestrator узнаёт вердикт.** Отчёт Session на ПК в PR: строка вердикта Gate и код выхода
   (ADR-0056, пункт 2). После `worfy-windows` 14 — только `[gate] зелено (full)` и код 0; сверка со
   списком известных падений больше не принимается (ADR-0056, «Последствия», `:73-77`).

## Готово, когда

- [ ] (вручную) `worfy-windows` 53, 51 и 14 — `done`; PR — в «Итог».
- [ ] (вручную) На ПК `node harness/hooks/gate.mjs full` без `CLAUDE_GATE_CONFIG` находит запись
      `worfy`; вывод с кодом — в «Итог».
- [ ] (вручную) Платформенный PR (первый после 14, например `worfy-polish` 19, PR #365) получил вердикт
      Windows — gate full на ПК, код 0 и `[gate] зелено (full)` — без сверки списков; время от запроса
      до вердикта — в «Итог».

## Тесты

Кода в этом репозитории Ticket не меняет. Test-ы — в Ticket-ах `worfy-windows` 53, 51, 14.

## Где в коде

— (кода нет; правки — PR-ы Ticket-ов `worfy-windows` и файл реестра на ПК вне репозитория)

Только читать: `harness/bin/project-connect`, `harness/hooks/gate-resolve.mjs`,
`.scratch/worfy-windows/issues/14-gate-full-на-windows.md`, `30-add-project-на-windows.md`.

## Вне скоупа

- Новые Ticket-ы `worfy-windows` и правка их текста.
- Windows-раннер на PR (правило владельца о цене CI).
- Установка Harness на ПК целиком — `worfy-windows` 13 и 16.

## Итог

**Закрыт без кода: заменён (Orchestrator, 2026-10-29).** Вопрос Ticket-а — как Orchestrator узнаёт вердикт
Windows без ручной сверки списков падений — решили другие Ticket-ы:

- Вердикт Windows — job-ы `ci-ok` на Windows-runner-е (`windows`, `windows-e2e`; ADR-0083, `worfy-throughput` 35,
  решения владельца по runner-ам 2026-10-28) и метка `check/windows` для PR со scope `pc`; ПК гоняет gate full на
  `main` раз в Wave (`worfy-throughput` 30, ADR-0086). Сверки списков известных падений нет нигде.
- Порядок пункта 1: `worfy-windows` 53 и 51 — `done`; 14 ещё в работе, но он больше не условие вердикта PR.
- Временный шаг пункта 2 не нужен: `worfy-windows` 30 («Add project» на Windows) — `done`, запись реестра Gate
  на ПК пишет `project-connect`.

Пункты «Готово, когда» не отмечены: они проверяют прежнюю схему (gate full на ПК на каждый платформенный PR).
