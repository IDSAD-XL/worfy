# 03 — Implementer гоняет только e2e своих spec-ов; весь `test:e2e` — в gate full перед мержем

Type: task
Status: claimed — 2026-10-16
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
  (`~/.claude/worfy-harness/projects/worfy/rules.md:37-44`): «e2e и gate full разных агентов — по одному,
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
  (`.scratch/worfy-polish/issues/04-три-нестабильных-e2e-ждут-состояние.md:43`). Такое правило
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
2. **(вручную, Orchestrator после мержа)** `rules.md` Profile-а worfy, правило о замке (`:37-44`):
   одна фраза — implementer гоняет под замком только свои spec-и (`pnpm test:e2e <файлы>`), весь
   `test:e2e` и `test:package` — gate full Orchestrator-а. Diff — в «Итог».
3. **Шаблон «Готово, когда»** — в «Соглашениях» spec-а `worfy-throughput` уже записан: «gate full —
   шаг Orchestrator-а перед merge». Старые Ticket-ы не переписываются.

Этот Ticket — не платформенный PR по ADR-0056, пункт 2: он меняет текст агента и shell test текста,
а не скрипт Harness, код с ветками по платформе или упаковку. Вердикт Windows ему не нужен.

## Готово, когда

- [x] `harness/agents/implementer.md` содержит правило пункта 1; `harness/bin/tests/agents-text.test.sh`
      проверяет его (фраза о `commands.e2e` и «only the e2e files the ticket touches»).
- [x] Правило не задевает Project без `commands.e2e`: test текста — абзац условный («if the profile
      sets `commands.e2e`»).
- [ ] (вручную, Orchestrator) правка `rules.md` Profile-а — diff в «Итог». Не проверено: шаг оркестратора.
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

- `harness/agents/implementer.md`, шаг 5 раздела «Order»: отдельный абзац после кодов gate.
  Открывается условием «E2e tests, if the profile sets `commands.e2e`»: implementer гоняет только
  e2e-файлы, которые Ticket добавил, изменил или назвал в разделе тестов, командой
  `<commands.e2e> <files>; echo "EXIT=$?"`. Весь набор e2e — `gate full` оркестратора перед мержем.
  `--repeat-each` и нагрузка CPU — только по «Готово, когда» Ticket-а. Замок e2e — по `rules.md`
  Profile-а. Последняя фраза: Profile без `commands.e2e` правила не получает.
- `harness/bin/tests/agents-text.test.sh`, раздел 11: абзац ищется внутри шага 5 (между строками
  `5.` и `6.`), должен быть отдельным абзацем и начинаться с условия; ещё пять фраз проверяются по
  тексту абзаца. Красный до правки текста (`passed 132, failed 1`). Мутанты на копии `agents/`
  через `AGENTS_DIR`: абзац удалён — `failed 1` («no paragraph with 'only the e2e files the ticket
  touches'»); условие убрано — `failed 1` («does not open with its condition»); пустая строка
  убрана, абзац слился с кодами gate — `failed 1`. С правкой — `passed 139, failed 0`.
- Решено без владельца, подтвердить: правило стоит внутри шага 5 отдельным абзацем, а не новым
  шагом — нумерация шагов 1–6 раздела «Order» закреплена test-ом и ссылками из skill-ов.
- gate full — шаг оркестратора перед merge, implementer его не запускал.
- Правка `~/.claude/worfy-harness/projects/worfy/rules.md` (шаг оркестратора после мержа; не внесена):

```diff
--- a/rules.md
+++ b/rules.md
@@ -34,7 +34,9 @@
   стоят в самом workflow: от 1 до 12 файлов из `test/unit/` и `test/contract/`, один job, 10 минут.
   Остальные агенты — Orchestrator в Stable copy, implementer, reviewer — его не запускают. Запуск
   не заменяет gate full на Windows-ПК владельца (ADR-0056).
-- **e2e и gate full разных агентов — по одному, под общим замком.** Несколько Electron e2e сразу
+- **e2e и gate full разных агентов — по одному, под общим замком.** Implementer гоняет под замком
+  только свои spec-и (`pnpm test:e2e <файлы>`); весь `test:e2e` и `test:package` — gate full
+  Orchestrator-а перед мержем. Несколько Electron e2e сразу
   мешают друг другу запуститься (`firstWindow` timeout; worfy-daily, волна 6). Каждый прогон
   `pnpm test:e2e` и `gate.sh full` — одной командой Bash с timeout 600000:
   `L=/tmp/worfy-e2e.lock; until mkdir "$L" 2>/dev/null; do m=$(stat -f %m "$L" 2>/dev/null) || continue; [ $(( $(date +%s) - m )) -gt 1800 ] && rmdir "$L"; sleep 20; done; ( while sleep 300; do touch -c "$L" 2>/dev/null || exit 0; done ) & HB=$!; trap 'kill $HB 2>/dev/null; rmdir "$L"' EXIT; <команда>`.
```
