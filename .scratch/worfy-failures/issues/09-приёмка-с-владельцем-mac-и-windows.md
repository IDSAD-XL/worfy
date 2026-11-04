# 09 — Приёмка Epic-а worfy-failures с владельцем: Mac и Windows-ПК

Type: task
Status: open
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08
Source: [spec.md](../spec.md), «Готово, когда» (все пункты), «Цель и что видит пользователь», «Windows», «Риски», п. 2–4; [ADR-0056](../../../docs/adr/0056-windows-checks-and-two-sessions.md), пункт 2 (платформенная часть — на Windows-ПК владельца)

## Что происходит

- К claim 01–08 влиты, у каждого свои test-ы: записи, reporter-ы, повтор, отчёт и перенос проверены на fixture и
  stub-процессах. Настоящего красного gate full на ПК с записями никто не видел.
- Приёмка — не в Autopilot: её ведёт владелец вместе с Orchestrator-ом и Session на ПК.

## Что делаем

1. Mac Stable и Harness — из `origin/main` с влитыми 01–08 (Replace Harness, `claude plugin list`). ПК — так же.
2. **Mac.** В отдельной ветке-проверке (не в PR) — test, который падает всегда, и test, который падает только под
   нагрузкой (stub со случайным отказом); gate fast, затем `rerun`, затем `report`. Ветка удаляется после.
3. **Windows-ПК.** Ближайший gate full на `main` по ADR-0086 — с записями; повтор, export по порядку Ticket-а 07,
   import и report на Mac.
4. Найденный дефект — новый Ticket Epic-а, номер дописывается в `Blocked by` этого.
5. Отмечает пункты «Готово, когда» в `spec.md` со ссылкой на «Итог».

Не входит: новые функции.

## Готово, когда

**Mac.**

- [ ] (вручную) Красный gate fast печатает `--- failure records: …`; файл run-а называет оба test-а, `step`,
      SHA, компьютер `mac`.
- [ ] (вручную) `gate-failures rerun --last` повторяет оба поодиночке; стабильно красный — красный, второй — по итогу.
- [ ] (вручную) `gate-failures report` показывает классы; `node scripts/quarantine-suggest.mjs` печатает запись,
      `test/quarantine/` не изменился.

**Windows-ПК.**

- [ ] (вручную) Красный (или с flaky) gate full на `main` оставил файл run-а в `%USERPROFILE%\.claude\worfy-harness\gate\state\failures\`.
- [ ] (вручную) `rerun` на ПК прошёл по test-ам vitest и Playwright без shell-ошибок; файл повтора записан.
- [ ] (вручную) Блок export дошёл до Mac путём из ответа на Q1; `import` принял его; в блоке нет имени пользователя,
      hostname и UUID (владелец смотрит текст).
- [ ] (вручную) Отчёт на Mac называет записи ПК с компьютером `PC` и платформой `win32`; bridge-Session текст отчёта
      не пересказывала.

**Итог.**

- [ ] Пункты «Готово, когда» spec-а отмечены со ссылкой на «Итог» этого Ticket-а.

## Тесты

- Test кода нет: приёмка вручную. Найденный дефект — новый Ticket со своим падающим test-ом.

## Где в коде

- `.scratch/worfy-failures/spec.md` (отметки «Готово, когда»)

Только читать: всё, что влили 01–08; `.scratch/worfy-failures/evidence/09/` — снимки текста отчётов, если владелец
захочет их оставить (после очистки).
