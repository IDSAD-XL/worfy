# 72 — Test-ы для выживших mutant-ов: pairing, origin wall, Wave и CI

Type: task
Status: claimed
Blocked by: —
Source: аудит mutation testing 2026-11-08, второй прогон (находки M1–M5 уровня medium). Строки перечитаны по main `f306a7e1c`.

## Что происходит

Второй прогон mutation testing нашёл пять мест, где поломка кода не роняет ни одного test-а:

1. `src/main/link/pairing.ts:478` — сторона A (та, что вводит код) проверяет подтверждение ключа `cB` от B. Mutant без
   этой проверки пережил все 28 файлов test-ов link. Без неё сторона, которая не знает кода, получает от A его
   подтверждение `cA` и token: по `cA` код подбирается offline, а token открывает A чужой Machine.
2. `pairing.ts:290` — `take()` отдаёт `null`, когда «Link a machine» закрыли во время попытки. Mutant `?? ''` выжил: если
   linking закрыли между первым сообщением и взятием кода, B продолжает SPAKE2 с пустым кодом.
3. `src/main/browser/live.ts:332` — Browser, чей Browser profile удалили, пока Session им управляет. Код уже верный:
   без profile origin wall отказывает любой странице. Это не bug, а пробел в test-ах: mutant, который отдаёт `null`
   (отказа нет), выжил, и с ним навигации страницы шли бы куда угодно.
4. `src/shared/workflow/waves.ts:163` — `filesOverlap`, когда папка у Ticket-а-кандидата. Ticket 01 с `src/x.ts` и
   Ticket 02 с `src/` попадали бы в одну Wave: единственный test держит папку у Ticket-а с меньшим номером.
5. `src/main/github/prs.ts:202-203` — состояния CI `ACTION_REQUIRED` и `EXPECTED`. Отображение уже верное: `EXPECTED`
   (required check ещё не отчитался) — `running`/`pending`, `ACTION_REQUIRED` — `failing`/`failure`. Test-ов не было;
   mutant-ы, которые их убирают, выжили, и с ними такой CI читался бы как зелёный.

## Что делаем

1. Test в `link-pairing.test.ts`: stand-in B отвечает на `pake1` верной share и неверным `cB`. A закрывает соединение
   с 4001 и не шлёт `pake3` — ни `cA`, ни token-а, ни своих данных.
2. Test в `link-pairing-failures.test.ts`: «Link a machine» закрывается, когда пришёл `pake1`, но код ещё не взят
   (`terminate()` придержан на этот вызов). B не шлёт `pake2`, закрывает с 4001, ничего не хранит.
3. Test в `browser-tools.test.ts`: profile удалён посреди управления, запрос всей страницы даже на origin из списка
   удалённого profile — `Fetch.failRequest`.
4. Test-ы в `waves.test.ts`: папка у Ticket-а с большим номером — он ждёт; `filesOverlap` с папкой с обеих сторон.
5. Test-ы в `github-prs.test.ts`: `EXPECTED` — `running` и `pending`, `ACTION_REQUIRED` — `failing` и `failure`
   (`ciOf` и `checksOf`).

Код приложения не меняется: пункты 3 и 5 — не bug-и. Глубина review — `low`. Не платформенный: только test-ы.

## Готово, когда

- [ ] Test A с неверным `cB` красный на mutant-е M1 и зелёный на исходном коде.
- [ ] Test закрытия до взятия кода красный на mutant-е M2 (`?? ''`) и зелёный на исходном коде.
- [ ] Test удалённого profile красный на mutant-е M3 (отказ `null`) и зелёный на исходном коде.
- [ ] Test-ы папки у кандидата красные на mutant-е M4 и зелёные на исходном коде.
- [ ] Test-ы `EXPECTED` и `ACTION_REQUIRED` красные на обоих mutant-ах M5 и зелёные на исходном коде.
- [ ] Все unit и contract test-ы link pairing, browser tools, waves и github prs, gate fast — exit 0.
- [ ] `ci-ok` зелёный на head PR.

## Где в коде

- `src/main/link/pairing.ts:290` — `take()`; `:478` — проверка `cB` у A.
- `src/main/browser/live.ts:330-333` — отказ origin wall без profile.
- `src/shared/workflow/waves.ts:161-165` — `filesOverlap`.
- `src/main/github/prs.ts:202-203` — `FAILED` и `PENDING_STATES`; `ciOf` и `checksOf`.
- `test/contract/link-pairing.test.ts` — новый test M1.
- `test/contract/link-pairing-failures.test.ts` — новый test M2.
- `test/contract/browser-tools.test.ts` — новый test M3.
- `test/unit/waves.test.ts` — новые test-ы M4.
- `test/contract/github-prs.test.ts` — новые test-ы M5.
