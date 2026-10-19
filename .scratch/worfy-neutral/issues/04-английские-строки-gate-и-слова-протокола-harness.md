# 04 — Английские строки Gate и слова протокола в скриптах Harness

Type: task
Status: blocked 2026-10-19T11:46Z
Blocked reason: ждёт срезов worfy-windows 14, которые правят test-ы скриптов Harness (Q14); Autopilot не берёт
Waits: agent
Blocked by: 02, 03
Source: решения владельца 2026-10-19, Q4, Q14, Q15 ([spec.md](../spec.md), «Решения владельца», пункты 4, 14,
15); [ADR-0074](../../../docs/adr/0074-harness-neutral-by-language-and-project.md), пункт 3.

## Что происходит

- Gate печатает `[gate] зелено (…)`, `[gate] красно (…)`, `[gate] ничего не прогналось (…)`,
  `[gate] ПРОВЕРИТЬ НЕ УДАЛОСЬ: …` и `… — окружение недоступно:` (`harness/hooks/gate.mjs:346`, `:825-849`,
  `:880`, `:952-987`, `:1017`; `harness/hooks/gate.sh:156,184`). В `gate.mjs` 85 строк с кириллицей, из них 15 —
  комментарии.
- Читают эти строки `harness/bin/wave-gate:452-459` и запасной путь приложения
  `src/main/gate/state.ts:186-193` (основной путь — JSON-вердикт, ADR-0044, пункт 5).
- Строки цитируют правила и skills: `harness/hooks/rules/common.md`, `harness/agents/implementer.md`,
  `harness/skills/ship-ticket/SKILL.md`, `harness/skills/epic-wave/SKILL.md`, `harness/skills/overnight-fix-loop/SKILL.md`.
- `harness/hooks/session-start.mjs:183` пропускает раздел `## Sources` или `## Источники` в `rules.md`
  Profile-а.
- Слова о языке ввода, а не протокол: `bin/ticket migrate` узнаёт русские слова старых шапок
  (`harness/bin/ticket:342-344`), `epic-status` — русские слова отрицания и «и» в `Blocked by`
  (`harness/bin/epic-status:208-210`), `silent-check` — «Тикет» (`harness/bin/silent-check:156`).
- **Платформенный PR** (Q15) — вердикт Windows. Ждёт срезов `worfy-windows` 14 (Q14).

## Что делаем

1. Строки Gate: `[gate] green (…)`, `[gate] red (…)`, `[gate] nothing ran (…)`, `[gate] not verified: …`,
   `[gate] not verified — environment unavailable:`; сообщения рядом — по-английски. Формат скобок и
   хвостов (`(passed: …)`, `(cache: …)`) сохраняется, только слова английские.
2. Читатели (`wave-gate`, `src/main/gate/state.ts`) принимают и новые, и старые строки один релиз, место
   помечено `shortcut: accepts the old Russian token, remove after the next release (worfy-neutral 08)`.
3. `session-start.mjs` — `## Sources`; `## Источники` — старое слово на один релиз, с той же пометкой.
4. Правила, agents и skills цитируют новые строки; там, где сказано «green only with the line …», — новая строка.
5. Списки русских слов ввода (`ticket`, `epic-status`, `silent-check`) — в один файл данных
   `harness/bin/lib/input-words.json` с английским комментарием в README рядом: это данные о языке
   проектов, а не протокол (предложение spec-а, «Риски»; другое решение владельца — правка этого пункта).
6. **(вручную, Orchestrator после мержа)** `rules.md` Profile-а worfy цитирует `[gate] зелено (full)` — правка
   на новую строку, diff — в «Итог».

## Готово, когда

- [ ] `harness/hooks/tests/gate-verdict.test.sh` — exit 0: зелёный, красный, «nothing ran» и «not verified»
      печатают новые строки; красный до правки.
- [ ] `harness/bin/tests/wave-gate.test.sh` — exit 0: вердикт по новой строке и по старой (один релиз).
- [ ] `pnpm test test/unit/gate-state.test.ts` — exit 0: старые и новые строки дают тот же `GateOutcome`.
- [ ] `grep -rn 'зелено\|красно\|ничего не прогналось\|ПРОВЕРИТЬ НЕ УДАЛОСЬ' harness --include=*.md` — пусто.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge; вердикт
      Windows с ПК.

## Тесты

Shell test-ы Harness во временном репозитории, `gh` — stub; сначала красные случаи новых строк.

## Где в коде

- `harness/hooks/gate.mjs`, `harness/hooks/gate.sh`, `harness/hooks/gate-resolve.mjs`
- `harness/bin/wave-gate`, `harness/bin/ticket`, `harness/bin/epic-status`, `harness/bin/silent-check`
- `harness/bin/lib/input-words.json` (новый)
- `harness/hooks/session-start.mjs`
- `harness/hooks/rules/common.md`, `harness/agents/implementer.md`
- `harness/skills/ship-ticket/SKILL.md`, `harness/skills/epic-wave/SKILL.md`, `harness/skills/overnight-fix-loop/SKILL.md`
- `harness/hooks/tests/*.test.sh`, `harness/bin/tests/*.test.sh` (те, что проверяют строки Gate)
- `src/main/gate/state.ts`, `test/unit/gate-state.test.ts`

## Итог

Заполняется при закрытии.
