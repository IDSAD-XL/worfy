# 08 — Урок «как распознать перегруженный `fseventsd`» в `docs/lessons/agents.md`

Type: task
Status: claimed 2026-10-17T10:43Z
Branch: worfy-reliability/08
Blocked by: —
Source: решение владельца 2026-10-16 по Ticket-у [03](03-сбой-инцидент-и-регрессионный-test-предложение-процесса.md):
кандидат 3 раздела «Follow-up Ticket-ы» и разбор 1 («`fseventsd` краснил gate full») документа
[docs/research/2026-10-15-сбой-инцидент-test.md](../../../docs/research/2026-10-15-сбой-инцидент-test.md).

## Что происходит

- 2026-10-12/13 test-ы с наблюдателем файлов (`docs.test.ts`, `claude-home-registry.test.ts`) краснели и
  на чистом main: `fseventsd` держал 102–116 % CPU и 4,2 ГБ; лечение — `sudo killall fseventsd`
  (документ, разбор 1).
- Признак и лечение живут только в `HANDOFF.md` («Риски и долги», первая строка) и в памяти
  Orchestrator-а. `HANDOFF.md` — снимок и будет сжат; урока в `docs/lessons/` нет.
- `worfy-windows` 26 связывает рост `fseventsd` с папками, которые test-ы оставляли во временном
  каталоге, и прямо пишет «причина не доказана». У утечки папок уже есть test против возврата —
  `test/unit/no-rmsync.test.ts`.
- По правилу владельца 2026-10-16 (Ticket 03, пункт 7) класс «временный сбой машины» ставится только
  после зелёного повтора того же commit-а, когда машину вылечили.

## Что делаем

1. **Урок** в `docs/lessons/agents.md` рядом с другими причинами ложно-красного e2e и gate
   (`agents.md:38-67`): заголовок-утверждение; признак — красные test-ы наблюдателя файлов и на чистом
   main, `fseventsd` в `top` с CPU около 100 % и гигабайтами памяти; лечение — владелец,
   `sudo killall fseventsd`; после лечения — повтор того же commit-а, и только зелёный повтор
   ставит класс «временный сбой машины».
2. **Связь с test-ом**: строка `Проверка: test/unit/no-rmsync.test.ts:<line>` — test против утечки папок
   во временном каталоге, одной из вероятных причин. Строка `Источник:` — `worfy-windows`/26,
   `worfy-reliability`/03.
3. **`HANDOFF.md`** — строка «Риски и долги» ссылается на урок вместо своих подробностей (короче).

## Готово, когда

- [x] Урок в `docs/lessons/agents.md` в формате `docs/lessons/README.md`, со строкой `Проверка:`.
- [x] Если Ticket 07 влит — `node scripts/check-lessons.mjs` exit 0.
- [x] `node scripts/check-handoff.mjs` — exit 0.
- [ ] gate fast — exit 0 и строка `[gate] зелено (fast)`, комментарий в PR (PR только с документами).

## Тесты

Нет новых: урок ссылается на `test/unit/no-rmsync.test.ts`.

## Где в коде

- `docs/lessons/agents.md`
- `HANDOFF.md`

Только читать (не в списке, чтобы не давать ложных пересечений Wave):
`.scratch/worfy-windows/issues/26-test-ы-на-windows-оставляют-папки-в-temp.md`, `test/unit/no-rmsync.test.ts`.

## Вне скоупа

- Поиск настоящей причины роста `fseventsd` — `worfy-windows` 26 её не доказал; новый Ticket — только
  по новому инциденту.
- Автоматическое лечение (`killall` из gate) — `sudo` делает владелец.

## Итог

- Урок «Test-ы наблюдателя файлов красные и на чистом main — сначала проверить `fseventsd` в `top`» —
  `docs/lessons/agents.md`, после трёх уроков о ложно-красном e2e (таймаут первого окна). Признак, лечение
  владельцем (`sudo killall fseventsd`), повтор того же commit-а перед классом «временный сбой машины».
- `Проверка: test/unit/no-rmsync.test.ts:152` — test «is called by no test: the folder of a test goes with
  removeTestTree». Он ловит одну причину утечки папок (rmSync с `recursive`, падавший на Windows); утечку
  по другой причине — позднюю запись Layout в `canvas-tools.test.ts` на Mac (`worfy-windows` 26) — не ловит,
  это сказано в самой строке.
- `HANDOFF.md`, «Риски и долги», первая строка — ссылка на урок вместо файлов test-ов, команды и замеров.
- `node scripts/check-lessons.mjs` — exit 0 (35 уроков, 20 со ссылкой); `node scripts/check-handoff.mjs` —
  exit 0 (75 строк, 15177 байт). Gate fast — в комментарии PR.
