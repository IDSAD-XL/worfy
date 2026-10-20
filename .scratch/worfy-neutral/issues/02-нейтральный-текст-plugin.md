# 02 — Нейтральный текст plugin: без владельца, Auction, Atakama, номеров ADR и путей worfy

Type: task
Status: done 2026-10-20T01:27Z
PR: #549
Blocked by: 01
Source: решения владельца 2026-10-19, Q1, Q7 ([spec.md](../spec.md), «Решения владельца», пункты 1, 7);
[ADR-0074](../../../docs/adr/0074-harness-neutral-by-language-and-project.md), пункт 1.

## Что происходит

Замер по main `07f17fa3`, `harness/` без test-ов (в скобках — с test-ами и eval-кейсами):

- Auction и Atakama — 41 строка в 16 файлах (165 строк в 23 файлах; больше всего —
  `harness/bin/tests/profile.test.sh`, 54, и `harness/hooks/tests/session-hooks.test.sh`, 34).
- Пути `/Users/…` — 10 строк в 4 файлах: `harness/bin/profile:172,177,206`, `harness/hooks/gate-resolve.mjs:57`,
  `harness/profiles/README.md:59,65,69,208` и др.
- Имена и учётные записи владельца — 10 строк в 4 файлах (20 строк в 8 файлах).
- Ссылки на ADR — 67 строк в 31 файле (108 строк в 46 файлах); пути `src/main/…` — 10 строк в 5 файлах; номера
  Ticket-ов вида `worfy-<epic> NN` — 30 строк.
- Правила, которые сейчас звучат как «ADR-0056, пункт 2», без текста правила не понятны тому, у кого нет
  репозитория worfy.
- **Платформенный PR** (Q15): меняет скрипты Harness (комментарии и сообщения) — вердикт Windows.

## Что делаем

1. Ссылка на ADR или Ticket в поставляемом файле `harness/` заменяется самим правилом в одной-двух фразах
   («Platform PRs wait for a full gate run on Windows» вместо «ADR-0056, point 2»). Если правило уже сказано
   рядом — ссылка просто уходит.
2. Auction, Atakama, имена, учётные записи и пути владельца — общими примерами: `demo`, `acme`,
   `/home/me/work/acme`, `octo-org`. В test-ах — те же замены; данные test-ов должны проверять то же самое.
3. Пути `src/main/…` и другие внутренности репозитория worfy — описанием («the app's gate reader») или пусто.
4. Новый test `harness/bin/tests/plugin-neutral.test.sh`: в `harness/` нет `Auction`, `Atakama`, `/Users/`,
   имён владельца (список — в test-е), `ADR-\d{4}`, `src/main/`. Исключения — только в самом test-е.
5. Кириллицу не трогаем: это 03, 04, 07. Языковых правил уже нет (01).

## Готово, когда

- [x] `bash harness/bin/tests/plugin-neutral.test.sh` — exit 0; на копии main до правки — exit 1 (красный).
- [x] Ревью с линзой «смысл сохранён»: каждая удалённая ссылка на ADR заменена правилом или правило уже есть рядом.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge; вердикт
      Windows — по ADR-0071.

## Тесты

Сначала `plugin-neutral.test.sh` (красный на main), потом правка. Существующие shell test-ы Harness с
заменёнными примерами проходят без изменения проверок.

## Где в коде

- `harness/README.md`, `harness/agents/*.md`, `harness/hooks/rules/*.md`, `harness/skills/*/SKILL.md`
- `harness/bin/*`, `harness/hooks/*.mjs`, `harness/hooks/*.sh`, `harness/profiles/README.md`
- `harness/evals/**`
- `harness/bin/tests/*.test.sh`, `harness/hooks/tests/*.test.sh`
- `harness/bin/tests/plugin-neutral.test.sh` (новый; `test/contract/harness-scripts.test.ts` берёт `*.test.sh` сам)

## Итог

Merged #549 (`96ada892`, 2026-10-20), 68 файлов в `harness/`.

- В поставляемых файлах `harness/` нет Auction, Atakama, `/Users/`, имён и учётных записей владельца, `ADR-NNNN`,
  `src/main/`, номеров Ticket-ов и wave worfy. Ссылка на ADR заменена самим правилом; примеры — `demo`, `acme`,
  `/home/me/work/acme`, `octo-org`. Бренд `worfy` остался.
- Новый test `harness/bin/tests/plugin-neutral.test.sh`: на main до правки — exit 1, на ветке — exit 0. Исключения —
  только в самом test-е, у каждого причина; устаревшее исключение — красный test.
- Проверки по живым проектам владельца (Auction, Atakama) в `profile.test.sh`, `session-hooks.test.sh`,
  `skill-blocks.test.sh` стали синтетическими. Удалены только проверки личных значений Profile владельца.
- Ревью: круг 1 high (смысл сохранён, test-ы, границы модулей) — 2 med + 5 low, исправлены; круг 2 medium — без
  high и med. Поведение скриптов не изменилось: меняются комментарии и три строки-описания.
- gate full зелёный на `8b0f364b` + main `e74014a9`. Windows: `check/windows` success на `8b0f364b` (ПК,
  `harness-scripts.test.ts` ветка против main: те же 8 красных — Ticket-ы `worfy-windows` 71 и 15; первый прогон
  поймал непереносимое ожидание пути в `session-hooks.test.sh`, исправлено). Runner: `harness-scripts.test.ts`
  не укладывается в предел 10 мин `windows-tests.yml`.
- `worfy-harness` 33 (личные пути в `harness/`) этим PR покрыт по сути, не дословно: живые проверки стали
  синтетическими, test лежит в `harness/bin/tests`, а не в `test/contract/`. Статус 33 — за Session-ом
  `worfy-harness`.

Долг (low, в 07 или отдельным follow-up):
- `plugin-neutral.test.sh:30` — исключение `bare ticket numbers|evals/` снимает проверку со всего `evals/`, включая
  `evals/lib/state-guard.cjs` и `case.yaml`; сузить до fixture-файлов demo.
- `plugin-neutral.test.sh:24` — шаблон wave ловит только `worfy-x, wave N`; голые `waves? [0-9]` в `harness/` — ноль,
  шаблон без исключений можно добавить.
- Комментарии `harness/bin/tests/agents-text.test.sh:177,265` («spec of worfy-review», «spec of worfy-harness, risk 4»)
  и `epic-wave-ship-ticket.test.sh:173` (`src/shared/agent/status-block.ts`) — шаблоны test-а их не ловят.
- Вне `harness/`: IDSAD-XL в `scripts/e3-sandbox.sh:50,56`, `test/acceptance/e3.spec.ts:41`,
  `test/contract/e3-sandbox.test.ts`, `github-prs.test.ts:584`, `shell.test.ts:161-163`.
- Найдено попутно, красно и на main: `test/contract/harness-script-command.test.ts` на Windows-runner-е — 2 test-а
  («skips a relative PATH entry…», «on Windows skips an entry rooted at the current drive…»); Ticket-а нет.
