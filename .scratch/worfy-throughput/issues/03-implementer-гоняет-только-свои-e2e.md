# 03 — Implementer гоняет только e2e своих spec-ов; весь `test:e2e` — в gate full перед мержем

Type: task
Status: open
Blocked by: —
Source: [spec.md](../spec.md), решение владельца 2026-10-16, пункт 1, и «Решено без владельца»
(Ticket записывает уже действующее правило); замер: `worfy-polish` 04 — 220 min до PR, 05 — 216 min,
общий замок e2e `/tmp/worfy-e2e.lock`.

## Что происходит

- **В Harness об e2e implementer-а нет ни слова.** Обязательные проверки implementer-а — шаг 5:
  `<commands.verify>` и `gate.mjs fast` (`harness/agents/implementer.md:157-160`). У worfy
  `commands.verify` — `pnpm lint && pnpm typecheck && pnpm test`, `commands.e2e` — `pnpm test:e2e`
  (`profile.json` Profile-а worfy). В `harness/agents/` и `harness/skills/` слов `e2e` и `test:e2e` нет.
- **Profile говорит только о замке.** `rules.md` Profile-а worfy
  (`~/.claude/worfy-harness/projects/worfy/rules.md:37-45`): «e2e и gate full разных агентов — по одному,
  под общим замком» `/tmp/worfy-e2e.lock`. Кто какой e2e гоняет — не сказано. Перед мержем весь
  `test:e2e` и `test:package` идут в gate full Orchestrator-а (`:25-28`).
- **Правило «весь `test:e2e` implementer-у Wave нельзя» уже действует, но только в брифе
  Orchestrator-а:** `.scratch/worfy-polish/issues/05-waitfortimeout-в-e2e-на-ожидание-состояния.md:38-39`
  («целиком его implementer-ам Wave запускать нельзя»). Записи нет — новая Session Orchestrator-а
  его не знает.
- **Шаблон «Готово, когда» двусмысленный.** Строка «gate full — exit 0 и строка `[gate] зелено (full)`»
  стоит в Ticket-ах, где gate full на деле делал Orchestrator: в одних так и дописано
  («(оркестратор перед merge)», `.scratch/worfy-polish/issues/22-убрать-блок-limits-из-rail-session.md:54-55`),
  в других — нет.
- **Тяжёлые implementer-ы замера — охота на flaky test-ы.** `worfy-polish` 04 и 05 гоняли
  `--repeat-each=10` под нагрузкой CPU по собственному «Готово, когда»
  (`.scratch/worfy-polish/issues/04-три-нестабильных-e2e-ждут-состояние.md:26-28`). Такое правило
  остаётся: этот Ticket время таких Ticket-ов не сокращает. Его выигрыш — меньше ожидания общего
  замка e2e соседями и одно понятное правило.
- `pnpm test:e2e` принимает файлы: `electron-vite build && playwright test --grep-invert @packaged`
  (`package.json:20`), аргументы уходят Playwright-у.

## Что делаем

1. **`harness/agents/implementer.md`, рядом с шагом 5** — generic абзац: если Profile задаёт
   `commands.e2e`, implementer гоняет только e2e-файлы, которые Ticket добавил или изменил, и те, что
   назвал его раздел «Тесты» (`<commands.e2e> <файлы>; echo "EXIT=$?"`). Весь набор e2e — шаг
   Orchestrator-а перед мержем (gate full). Повторы (`--repeat-each`) и нагрузка CPU — только когда их
   требует «Готово, когда» Ticket-а. Замок e2e — по `rules.md` Profile-а.
2. **(вручную, Orchestrator после мержа)** `rules.md` Profile-а worfy, правило о замке (`:37-45`):
   одна фраза — implementer гоняет под замком только свои spec-и (`pnpm test:e2e <файлы>`), весь
   `test:e2e` и `test:package` — gate full Orchestrator-а. Diff — в «Итог».
3. **Шаблон «Готово, когда»** — в «Соглашениях» spec-а `worfy-throughput` уже записан: «gate full —
   шаг Orchestrator-а перед merge». Старые Ticket-ы не переписываются.

## Готово, когда

- [ ] `harness/agents/implementer.md` содержит правило пункта 1; `harness/bin/tests/agents-text.test.sh`
      проверяет его (фраза о `commands.e2e` и «only the e2e files the ticket touches»).
- [ ] Правило не задевает Project без `commands.e2e`: test текста — абзац условный («if the profile
      sets `commands.e2e`»).
- [ ] (вручную, Orchestrator) правка `rules.md` Profile-а — diff в «Итог».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; shell test-ы Harness — exit 0; gate full —
      шаг Orchestrator-а перед merge; Linux CI зелёный.

## Тесты

- `harness/bin/tests/agents-text.test.sh` — новая проверка текста implementer-а.
- Сначала красный: проверка до правки текста.
- Мутант: убрать условие «if the profile sets `commands.e2e`» — test краснеет.

## Где в коде

- `harness/agents/implementer.md`
- `harness/bin/tests/agents-text.test.sh`

Вне репозитория (шаг Orchestrator-а): `~/.claude/worfy-harness/projects/worfy/rules.md`.

## Вне скоупа

- Поле Profile-а для запуска одного e2e (`test_one` — `null`) — не нужно: `pnpm test:e2e <файл>` уже
  работает.
- Расписание параллельных implementer-ов под нагрузкой (кто с кем в одной Wave) — правило «без
  соседей» в spec-ах Epic-ов остаётся.
- Ускорение самого `test:e2e`.

## Итог
