# 04 — Английские строки Gate и слова протокола в скриптах Harness

Type: task
Status: done 2026-10-20T17:50Z
PR: #590
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

- [x] `harness/hooks/tests/gate-verdict.test.sh` — exit 0: зелёный, красный, «nothing ran» и «not verified»
      печатают новые строки; красный до правки.
- [x] `harness/bin/tests/wave-gate.test.sh` — exit 0: вердикт по новой строке и по старой (один релиз).
- [x] `pnpm test test/unit/gate-state.test.ts` — exit 0: старые и новые строки дают тот же `GateOutcome`.
- [x] `grep -rn 'зелено\|красно\|ничего не прогналось\|ПРОВЕРИТЬ НЕ УДАЛОСЬ' harness --include=*.md` — пусто.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge; вердикт
      Windows с ПК.

## Тесты

Shell test-ы Harness во временном репозитории, `gh` — stub; сначала красные случаи новых строк.

## Где в коде

- `harness/hooks/gate.mjs`, `harness/hooks/gate.sh`, `harness/hooks/gate-resolve.mjs`
- `harness/bin/wave-gate`, `harness/bin/ticket`, `harness/bin/epic-status`, `harness/bin/silent-check`
- `harness/lib/input-words.json` (новый; путь изменён в PR — см. «Итог»)
- `harness/hooks/session-start.mjs`
- `harness/hooks/rules/common.md`, `harness/agents/implementer.md`
- `harness/skills/ship-ticket/SKILL.md`, `harness/skills/epic-wave/SKILL.md`, `harness/skills/overnight-fix-loop/SKILL.md`
- `harness/hooks/tests/*.test.sh`, `harness/bin/tests/*.test.sh` (те, что проверяют строки Gate)
- `src/main/gate/state.ts`, `test/unit/gate-state.test.ts`

## Итог

Влит #590 (2e4f6254). Проверки Orchestrator-а: gate full — зелено дважды, второй раз на `main` 54a37547 вместе
с #595 (4 общих файла Harness); `plugin-neutral` 26/0, `harness-scripts` 45/45; вердикт Windows с ПК
(`check/windows`). Review: круг 1 — high, три lens, 37 из 46 mutant-ов убиты; круг 2 — medium; high и med нет.

- Пункт 1: `gate.mjs`, `gate.sh` печатают `[gate] green (P): …` (с `(cache)` / `(cache: …)`),
  `[gate] red (P): … (passed: …)`, `[gate] nothing ran (P): … This is not green.`, `[gate] not verified: …`,
  `[gate] not verified — environment unavailable:`. Exit code-ы и JSON-вердикт не изменились.
- Пункт 2: строки разбирают только `harness/bin/wave-gate` и `src/main/gate/state.ts` (запасной разбор
  transcript-а); оба принимают новые и старые слова. Слово вердикта должно стоять перед пробелом, `(`, `:` или
  концом строки — `reduced`, `greenish` не совпадают. `stop.mjs`, `guard.mjs`, skill gate-queue и renderer
  строк не разбирают. Слова wave-gate сверяются test-ом с литералами `gate.mjs`.
- Пункт 3: `session-start.mjs` вырезает `## Sources` и старый заголовок.
- Пункт 4: правила, implementer и три skill-а цитируют только новые строки; оговорка «Gate прошлого release
  печатает русское слово» — в двух местах `epic-wave/SKILL.md`.
- Пункт 5: файл данных — `harness/lib/input-words.json` (README рядом), а не `harness/bin/lib/`: `lib/` уже
  есть для общих файлов скриптов (`pipeline.cjs`, `../lib/`), копируется установкой и `preflight.test.sh`;
  в `bin/` — только исполняемые. `silent-check` читает файл только в режиме Silent (битый файл — exit 2, guard
  отказывает); в режиме Full не читает.
- Пункт 6 — шаг владельца, diff показывает Orchestrator: `rules.md` Profile-а worfy, строки 37, 40 («зелено» →
  `green`), 109, 113 («ничего не прогналось» → `nothing ran`); по желанию 167 `## Источники` → `## Sources` до 08.
- Пометка внутри `harness/` — `shortcut: accepts the old Russian token, remove after the next release` без
  `(worfy-neutral 08)`: `plugin-neutral.test.sh` запрещает номера Ticket-ов worfy в файлах plugin. В `src/` и
  `test/` — полная. Поэтому 08 ищет `accepts the old Russian token`.

Долг (low):
- `ticket` и `epic-status` читают `input-words.json` при запуске — битый файл ломает все их команды;
- в `ticket`, `epic-status`, `silent-check` — по своей копии escape-функции и сборки regex над общим файлом;
  README говорит «целое слово», а `silent-check` принимает любое окончание без учёта регистра —
  кандидат `harness/lib/input-words.cjs`;
- `wave-gate.test.sh:391` — `rc=$?` берёт код `tr`, не `node` (нет pipefail);
- `silent-mode.test.sh` — нет случая на проверку формы файла (`{"ticketWord":"x"}`, `silent-check:162`);
- `state.ts:218` — `\r` в lookahead лишний: `$` с флагом `m` уже совпадает перед `\r`.
