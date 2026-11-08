# 03 — Чистка `docs/`, `HANDOFF.md`, `CONTEXT.md`, `README.md`

Type: task
Status: open
Blocked by: 01
Source: [spec.md](../spec.md), «Что нашла разведка 2026-11-08»; «Как работает» → «Чистка»; «Решено без владельца», п. 5; Q1, Q2

Не платформенный: только документы. Глубина ревью — `medium`: правка текста принятых ADR.

## Что происходит

- `docs/adr`: 18 файлов с именами других проектов владельца, ≈ 65 строк. 7 ADR называют аккаунт репозитория там, где
  он адрес репозитория — эти строки остаются (Q1).
- Остальное `docs/` (страницы Feature и `ru/` копии, roadmap, design, research) — ≈ 67 строк; адрес tailnet — в
  `docs/features/link.md:15` и `docs/features/ru/link.md:17`.
- `HANDOFF.md` и `CONTEXT.md` — 3 строки. `README.md` — clone URL с аккаунтом репозитория (остаётся).
- Правило ADR (`rules-adr.md`): текст принятого ADR не переписывается, изменения — в датированном `## Amendments`.

## Что делаем

1. Отчёт guard-а по этим путям — список работы.
2. ADR (Q2): заменить только личные строки нейтральными словами, смысл не менять. В конце каждого тронутого ADR —
   раздел `## Amendments` (создать, если нет) со строкой «2026-11-xx: личные имена заменены нейтральными словами
   (Epic worfy-scrub), смысл не менялся», дата — день merge.
3. Страницы Feature и `ru/` копии — одинаковые правки в обеих; адрес tailnet → `<host>.<tailnet>.ts.net` или
   «адрес MagicDNS».
4. Прочее `docs/`, `HANDOFF.md`, `CONTEXT.md` — по таблице spec-а («Чистка»).
5. Аккаунт репозитория в URL и в примерах команд, которые без него не работают, — не трогать.

## Готово, когда

- [ ] Отчёт guard-а по `docs/`, `HANDOFF.md`, `CONTEXT.md`, `README.md` — ноль находок, кроме аккаунта репозитория в
      URL.
- [ ] `git diff origin/main -- docs/adr` меняет только строки с личным и дописывает `## Amendments`; второй агент
      проверил, что смысл каждой правленой строки ADR не изменился.
- [ ] `node scripts/check-feature-docs.mjs`, `node scripts/check-handoff.mjs`, `node scripts/check-cyrillic.mjs` —
      exit 0; `ci-ok` на PR зелёный.

## Тесты

- Документы; test-ов нет. Проверка — отчёт guard-а и второй агент по ADR.

## Где в коде

- `docs/**`
- `HANDOFF.md`
- `CONTEXT.md`
- `README.md`
