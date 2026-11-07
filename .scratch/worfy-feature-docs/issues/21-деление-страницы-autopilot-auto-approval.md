# 21 — Деление страницы Autopilot: Auto-approval на своей странице

Type: task
Status: done 2026-11-07T08:12Z
PR: #1569
Blocked by: —
Source: решение владельца 2026-11-07, Q1 («да»: вынести Auto-approval со страницы Autopilot); Ticket [20](20-деление-страницы-autopilot.md) (его `## Итог` назвал кандидатов на следующее деление); «Как устроено» [spec.md](../spec.md) и решение владельца 2026-10-30, Q9 (страница больше примерно 400 строк делится на две); [ADR-0088](../../../docs/adr/0088-feature-pages-in-english.md) (английский как основной язык Feature page)

## Что происходит

- `docs/features/autopilot.md` — 674 строки на `main` 201947d7, перевод `docs/features/ru/autopilot.md` — 678. Правило
  Epic-а — больше примерно 400 строк делится на две.
- Ticket 20 вынес ожидания, остановки и Fault scenario-и на `docs/features/autopilot-faults.md`, но страница осталась на
  635 строках, а Ticket worfy-autopilot-queue 19 дописал её до 674. Ticket 20 назвал кандидатов на следующее деление:
  Auto-approval и запуск run-а из чата.
- Auto-approval описан в двух местах страницы: раздел `#### Auto-approval` в Behaviour (режимы, исходы политики, hard deny,
  где смотреть решения) и два длинных пункта списка в `#### During a run` (что бывает с запросом разрешения в Shadow и
  On, в том числе на Codex; временная папка и git-окружение run-а). Строки test-ов `auto-approve-*` — в `#### Tests`.
- На раздел ссылается `docs/features/sessions.md` (`autopilot.md#auto-approval`).

## Что делаем

1. Читает страницу и код из свежего `origin/main`. Новая страница `docs/features/auto-approval.md` получает всё об
   Auto-approval: раздел Behaviour, оба пункта из «During a run», абзац о том, почему политика не делает run опаснее
   `bypassPermissions` (в How it works), строки test-ов `auto-approve-*`.
2. Если `autopilot.md` и после этого заметно больше примерно 400 строк — выносит ещё один раздел, только самостоятельный
   (например запуск run-а из чата с `/worfy:epic-wave` и `autopilot_start`); выбор и итоговые размеры — в `## Итог`.
3. Новая страница — по шаблону Epic-а: **Behaviour**, **How it works**, **Implementation**; без номеров строк, без
   changelog. `autopilot.md` ссылается на неё одной строкой там, где была перенесённая часть.
4. Перевод в `docs/features/ru/` с шапкой `> Перевод [английской версии](../<page>.md), commit `same-pr`.` под
   заголовком; из `docs/features/ru/autopilot.md` уходит та же часть.
5. Строка новой страницы в индексе `docs/features/README.md` и `docs/features/ru/README.md`. Ссылки `docs/`, `src/`
   (Guide: `topic.json` и тексты), `CONTEXT.md`, `README.md` на перенесённые разделы ведут на новую страницу.

Не входит: правка содержания перенесённой части, кроме ссылок и одной вводной фразы.

## Готово, когда

- [ ] `docs/features/autopilot.md` не больше примерно 400 строк или в `## Итог` сказано, почему остальное не вынесено;
      размеры всех страниц до и после — в `## Итог`.
  - evidence: commit pass · docs(features): move Auto-approval and the start from a chat off the Autopilot page (worfy-feature-docs 21) · - - · 05c4b6378
  - evidence: review pass · PR #1569 · - - · 923bef85334f2725190a9bc7e6c0e73388edc9a1
- [ ] Перевод новых страниц в `docs/features/ru/` с шапкой; из `docs/features/ru/autopilot.md` ушла та же часть.
  - evidence: commit pass · docs(features): move Auto-approval and the start from a chat off the Autopilot page (worfy-feature-docs 21) · - - · 05c4b6378
  - evidence: review pass · PR #1569 · - - · 923bef85334f2725190a9bc7e6c0e73388edc9a1
- [ ] Индекс на обоих языках называет новые страницы; ни одна ссылка на перенесённый раздел не ведёт в пустоту
      (якоря проверены скриптом).
  - evidence: commit pass · docs(features): move Auto-approval and the start from a chat off the Autopilot page (worfy-feature-docs 21) · - - · 05c4b6378
  - evidence: review pass · PR #1569 · - - · 923bef85334f2725190a9bc7e6c0e73388edc9a1
- [ ] `node scripts/check-feature-docs.mjs`, `node scripts/check-handoff.mjs`, `pnpm lint`, `pnpm typecheck`, `pnpm test` —
      exit 0; gate fast зелёный; `ci-ok` зелёный. Gate full не нужен: код не меняется.
  - evidence: test-run pass · `node scripts/check-feature-docs.mjs && node scripts/check-handoff.mjs && pnpm lint && pnpm typecheck && pnpm test` exit 0 · mac - · 05c4b6378
  - evidence: gate pass · `gate fast` exit 0 · mac - · 05c4b6378
  - evidence: review pass · PR #1569 · - - · 923bef85334f2725190a9bc7e6c0e73388edc9a1
- [ ] Review: один агент уровня `low` проверяет, что утверждения перенесены без изменений и ссылки живые.
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/42352740577/job/128348295805 · ci - · 923bef85334f2725190a9bc7e6c0e73388edc9a1

## Тесты

Новых test-ов нет. Проверка путей Ticket-а 02 (`scripts/check-feature-docs.mjs`) читает новые английские страницы;
якоря ссылок проверяет разовый скрипт в scratchpad (в репозиторий не кладётся).

## Где в коде

- `docs/features/autopilot.md`
- `docs/features/auto-approval.md` (новый)
- `docs/features/ru/autopilot.md`
- `docs/features/ru/auto-approval.md` (новый)
- Вторая новая страница и её перевод, если `autopilot.md` после шага 1 заметно больше примерно 400 строк
- `docs/features/README.md`
- `docs/features/ru/README.md`
- Страницы со ссылками на перенесённые разделы: `docs/features/sessions.md`, `docs/features/cards.md` и их переводы
- `src/renderer/guide/topics/autopilot/topic.json`, если Topic опирается на перенесённый раздел
- `.scratch/worfy-feature-docs/spec.md` (строка Ticket-а 21)

## Вне скоупа

- Исправление найденных багов продукта и расхождений страницы с кодом: такая находка — в `## Итог`.
- Деление других страниц.

## Итог

**Что перенесено** без правки текста, блоками строк (разовый скрипт сверил: каждая старая строка `autopilot.md` есть на одной
из трёх страниц, кроме трёх строк с правкой ссылки ниже; так же для перевода).

- `docs/features/auto-approval.md` (Auto-approval): Behaviour — раздел `#### Auto-approval` (режимы, исходы политики,
  hard deny, где смотреть решения) под заголовком «The mode and the approval policy» и оба пункта списка из
  «During a run» (запрос разрешения в Shadow и On на обоих Vendor-ах, в том числе на Codex; временная папка и
  git-окружение run-а) под заголовком «During a run»; How it works — абзац о том, почему политика не делает run опаснее
  `bypassPermissions` (ADR-0098); Implementation — 11 строк test-ов `auto-approve-*`.
- `docs/features/autopilot-chat.md` (Starting Autopilot from a chat): Behaviour — раздел «Starting a run from a chat»
  (команда `/worfy:epic-wave` и инструмент `autopilot_start` с окном просьбы и отказами); Implementation — шесть строк
  модулей (`chat-start.ts`, `chat-command.ts`, `wave-plan.ts`, `ipc/agent.ts`, `chat-confirm.ts`, `ipc/autopilot-confirm.ts`) и
  шесть строк test-ов.
- На `autopilot.md` на месте каждой части — одна-две строки со ссылкой; заголовки `#### Starting a run from a chat` и
  `#### Auto-approval` остались, так что старые якоря не пустые. Абзац «What is not a run» остался на `autopilot.md`.

**Правки текста — только ссылки.** «Off: as above» в перенесённом пункте стало «Off: the refusal of an unattended Session,
as in [Autopilot, During a run]»: «выше» на новой странице никуда не указывало. Два «as described under "While the
Orchestrator is busy"» на странице чата получили ссылку на `autopilot.md#starting-a-run`. Вводные фразы новых страниц,
строки «How it works» страницы чата и «Modules» страницы Auto-approval — только ссылки на `autopilot.md`, `sessions.md` и
`flight-recorder.md`.

**Размеры (строк).**

| Страница | До (`main` 201947d7) | После |
|---|---|---|
| `docs/features/autopilot.md` | 674 | 482 |
| `docs/features/auto-approval.md` | — | 160 |
| `docs/features/autopilot-chat.md` | — | 110 |
| `docs/features/ru/autopilot.md` | 678 | 485 |
| `docs/features/ru/auto-approval.md` | — | 161 |
| `docs/features/ru/autopilot-chat.md` | — | 114 |

**Почему вынесен и запуск из чата.** После выноса Auto-approval `autopilot.md` оставалась на 553 строках, заметно больше
~400. Раздел о запуске из чата самостоятелен: свой вход в run (команда и инструмент), свои модули и test-ы, на остальную
страницу ссылается только как на «тот же run, что и кнопка» и на абзац «While the Orchestrator is busy».

**Почему 482 строки, а не ~400.** Остальное — сам run: кнопка и окно Start Autopilot, очередь Epic-ов, «During a run»,
конец Wave, Run mode, journal, How it works, модули и test-ы. Очередь Epic-ов размазана по запуску, «During a run», How
it works и journal, отдельно не читается. Следующий кандидат — `#### The journal file` (формат файла и таблица видов
строк, около 40 строк): он самостоятелен, но страница осталась бы около 440 строк, а на него ссылаются Flight Recorder
(`#the-journal-file`) и Run planning («The Autopilot page lists every line of the journal»). Не вынесен: выигрыш мал,
а формат journal отделился бы от run-а, который его пишет. Решать владельцу: принять 482 строки (на `main` есть страницы на
592 и 455 строк) или новый Ticket на journal.

**Перевод.** `docs/features/ru/autopilot.md` был свежим (шапка `same-pr`, `feature-docs-lag` его не называл), поэтому
русские части перенесены теми же блоками, а не переведены заново; шапка `same-pr` осталась верной. Новые
`ru/auto-approval.md` и `ru/autopilot-chat.md` — с шапкой `same-pr`.

**Ссылки.** `sessions.md` (Auto-approval) ведёт на `auto-approval.md`, `cards.md` (строка `autopilot_start`) — на
`autopilot-chat.md`; их переводы ссылок на эти разделы не имеют. Ссылки `#during-a-run` из `vendors.md`, `harness.md`,
`sessions.md` и `autopilot-faults.md` говорят о Codex hooks, Full access и очереди — эти пункты остались на `autopilot.md`.
Ссылок из кода, `CONTEXT.md` и `README.md` на разделы `autopilot.md` нет. Разовый скрипт якорей (GitHub slug заголовков
целевой страницы) прошёл по всем ссылкам с `#` в `docs/`, `README.md`, `CONTEXT.md`: 144 ссылки, 2 битые, обе были и до
Ticket-а — `harness.md#in-codex` из `ru/autopilot.md` и `ru/vendors.md` (в `ru/harness.md` нет раздела «In Codex»: перевод
отстаёт).

**Guide.** Topic Autopilot в тексте описывает запуск из чата, поэтому `topic.json` называет `autopilot-chat.md` источником
с тем же commit `cb75f5a9`, на котором Topic сверяли с `autopilot.md`; `scripts/guide-lag.mjs` показывает его отстающим на
этот Ticket (так задумано). Об Auto-approval Topic не пишет — источник не добавлен.

**Решения без владельца:** имена страниц `auto-approval.md` и `autopilot-chat.md` и заголовок «Starting Autopilot from a
chat»; вынос запуска из чата вторым разделом; journal оставлен на `autopilot.md`; строки Auto-approval в таблице видов
journal (вид `auto-approval`) и поле `run-started.autoApproval` остались в описании journal на `autopilot.md`.

**Вне Ticket-а.** На странице Auto-approval нет таблицы модулей политики (`src/main/agent/auto-approve/`,
`src/shared/agent/auto-approval.ts`): её не было и на `autopilot.md`, перенос её не добавил — кандидат для линзы
`documentation` аудита.
