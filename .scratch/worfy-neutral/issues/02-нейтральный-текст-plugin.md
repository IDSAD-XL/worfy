# 02 — Нейтральный текст plugin: без владельца, Auction, Atakama, номеров ADR и путей worfy

Type: task
Status: claimed 2026-10-19T21:35Z
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

- [ ] `bash harness/bin/tests/plugin-neutral.test.sh` — exit 0; на копии main до правки — exit 1 (красный).
- [ ] Ревью с линзой «смысл сохранён»: каждая удалённая ссылка на ADR заменена правилом или правило уже есть рядом.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge; вердикт
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

Заполняется при закрытии.
