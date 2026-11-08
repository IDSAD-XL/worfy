# 10 — Правила Product Session и выбор набора правил по виду Session

Type: task
Status: blocked 2026-11-07T20:19Z
Blocked reason: ждёт Epic worfy-skills целиком (spec.md, «Волны»)
Waits: agent
Blocked by: 02
Source: [spec.md](../spec.md), «Решения владельца 2026-11-07», п. 1–4, 8, 11; «Как работает» → «Harness»; «Вопросы владельцу», Q3–Q7; «Риски», п. 1; карта [worfy-product](../../worfy-product/map.md), «Not yet specified» (содержание правил Product Session); research [product-session-основа](../../../docs/research/2026-11-07-product-session-основа.md), раздел 2.1

**Ждёт Epic `worfy-skills` целиком:** правила ссылаются на `worfy:wayfinder`, `worfy:grilling`, `worfy:research`,
`worfy:prototype`, `worfy:to-spec`; `worfy-skills` 02 правит тот же `hooks.json`.

Платформенный Ticket: hook-и Harness (`hooks.json`, `inject-rules.mjs`) идут в каждой Session на Mac и Windows;
Windows verdict до merge (ADR-0056). Глубина ревью — `high`.

## Что происходит

- `SessionStart` зовёт `inject-rules.mjs orchestrator` без matcher-а (`harness/hooks/hooks.json:9`) и `common`
  (`:18`): правила Orchestrator-а получает каждая главная Session.
- Набор правил выбирает только аргумент (`harness/hooks/inject-rules.mjs:33`, файл `rules/<part>.md` — `:38`); имя
  проверяется на `/`, `\` и точку в начале (`:35`). Предел одной части — 10000 символов (`:24`), проверка —
  `harness/hooks/tests/rules-hooks.test.sh:59`, `:116`.
- Ticket 02 кладёт `WORFY_SESSION_KIND=product` в `env` Product Session. Получает ли его процесс hook-а — не проверено
  (research, «Что не проверено»).
- Раздел «Wayfinding operations» `harness/bin/TICKETS.md` называет tracker-ом папку Ticket-ов Profile-а; для Product
  Session карта живёт в `docs/product/<тема>/`.

## Что делаем

1. Первым — test на stub-е `claude`: hook `SessionStart` видит переменную из `env` Session. Нет — путь риска 1 spec-а
   (`systemPrompt.append` из приложения), записать в «Итог».
2. `inject-rules.mjs`: часть `orchestrator` при `WORFY_SESSION_KIND=product` печатает пусто; новая часть `product`
   печатает `rules/product.md` только при этой переменной. Запись `inject-rules.mjs product` в `hooks.json`.
3. `harness/hooks/rules/product.md` (английский, ADR-0074, ≤ 10000 символов):
   - кто ты: советник Product owner-а; решает человек; Epic-и и их порядок — только его (ADR-0100);
   - процесс: тема — папка `docs/product/<тема>/` (Silent mode — Q6); карта по `worfy:wayfinder`, вопросы по одному
     (`worfy:grilling`), `worfy:research`, прототип в Card (`worfy:prototype`), черновик Epic-а по `worfy:to-spec` в
     `drafts/<epic>.md` с пометкой «черновик советника» (Q4);
   - каждое предложение, вопрос, возражение и решение — узел Mind map через `mind_map_*`; принятое или отклонённое —
     `mind_map_decide` с причиной словами владельца; совет — `advice: true`;
   - за каждым возражением — факт: путь, Ticket, PR, URL; без факта — это вопрос, а не возражение;
   - чего не знаешь — говори: аналитики продукта нет, какой функцией пользуются — неизвестно;
   - нельзя: правки кода, Ticket-ы, gate, merge, Autopilot, любые команды git, кроме чтения (Q3, Q5);
   - «сохранить» от владельца — tool `product_save` (Ticket 04); `docs/product/` сохраняет Orchestrator docs PR-ом,
     в Silent mode сохранять нечего;
   - критик — Subagent `worfy:critic` по просьбе; идеи — `worfy:product-ideas` по просьбе.
4. `common.md`: одна строка — `docs/product/` пишет только Product Session; другие Session-ы и Subagent-ы его читают
   (Q7).
5. `TICKETS.md`, «Wayfinding operations»: абзац — в Product Session tracker карты — папка темы `docs/product/<тема>/`,
   операции те же.

## Готово, когда

- [ ] Test: с `WORFY_SESSION_KIND=product` `SessionStart` даёт `common` + `product`, без `orchestrator`; без переменной —
      как раньше (`orchestrator` + `common`), `product` печатает пусто.
  - evidence: test-run pass · `bash harness/hooks/tests/rules-hooks.test.sh` exit 0 · mac - · 42e637544d4053ab035ed3466d65f59eedc80d4d
- [ ] `product.md` называет «сохранить» → `product_save` и запрет git (проверка текста в `rules-hooks.test.sh`).
  - evidence: test-run pass · `bash harness/hooks/tests/rules-hooks.test.sh` exit 0 · mac - · 42e637544d4053ab035ed3466d65f59eedc80d4d
- [ ] Test: `product.md` ≤ 10000 символов и с длинным корнем plugin-а (`rules-hooks.test.sh`).
  - evidence: test-run pass · `bash harness/hooks/tests/rules-hooks.test.sh` exit 0 · mac - · 42e637544d4053ab035ed3466d65f59eedc80d4d
- [ ] Test: hook `SessionStart` видит переменную `env` Session — или «Итог» называет запасной путь и он сделан.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/harness-plugin.test.ts` exit 0 · mac - · 42e637544d4053ab035ed3466d65f59eedc80d4d
- [ ] `bash harness/hooks/tests/rules-hooks.test.sh` — exit 0 на Mac.
  - evidence: test-run pass · `bash harness/hooks/tests/rules-hooks.test.sh` exit 0 · mac - · 42e637544d4053ab035ed3466d65f59eedc80d4d
- [ ] Тот же test на Windows (Git Bash) — exit 0.
  - needs: windows
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0; `ci-ok` на PR зелёный (Linux, macOS и Windows job-ы).

## Тесты

- Shell `harness/hooks/tests/rules-hooks.test.sh`.
- Contract `test/contract/codex-parity.test.ts` (Codex зовёт тот же `hooks.json`: без переменной ничего не меняется),
  `test/contract/harness-plugin.test.ts`.
- Сначала падающий: на `main` с `WORFY_SESSION_KIND=product` приходят правила Orchestrator-а.

## Где в коде

- `harness/hooks/rules/product.md` (новый)
- `harness/hooks/inject-rules.mjs`
- `harness/hooks/hooks.json`
- `harness/hooks/rules/common.md`
- `harness/hooks/tests/rules-hooks.test.sh`
- `harness/bin/TICKETS.md`
- `test/contract/codex-parity.test.ts`
- `test/contract/harness-plugin.test.ts`

Только читать: `harness/hooks/session-start.mjs`, `src/main/vendors/claude/options.ts` (`env`, `systemPrompt`),
`harness/skills/wayfinder/SKILL.md`, `harness/skills/to-spec/SKILL.md`.
