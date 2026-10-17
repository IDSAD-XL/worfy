# 20 — SPAKE2: строгая кодировка доли и test-ы по всем векторам RFC 9382

Type: task
Status: done 2026-10-16
PR: #400
Branch: worfy-link/20
Blocked by: —
Source: независимое ревью SPAKE2, Ticket [17](17-независимое-ревью-spake2.md), находки Н1 (med) и Н2 (low)

## Что происходит

- Pairing — связывание двух Machine (компьютеров с worfy) по 6-значному коду — идёт по протоколу
  SPAKE2 (RFC 9382, набор P256-SHA256-HKDF-HMAC). Код — `src/main/link/pairing.ts`.
- Приложение B RFC 9382 даёт для этого набора **четыре** test vector-а: идентичности
  `A='server', B='client'`, `A='', B='client'`, `A='server', B=''`, `A='', B=''`. Test
  `test/contract/link-pairing.test.ts:59-81` проверяет только первый. Комментарий в коде
  (`pairing.ts:16-17`) говорит о «test vectors» во множественном числе. Ревью Ticket-а 17 прогнало все
  четыре через `spake2Share` и `spake2Finish` одноразовым скриптом: все 44 значения совпали. Но в
  репозитории это не закреплено.
- RFC 9382, раздел 7: «Elements received from a peer MUST be checked for group membership… An
  endpoint MUST abort the protocol if any received public value is not a member of G». В коде эту
  проверку делает `Point.fromBytes` библиотеки `@noble/curves` (`pairing.ts:97-98`). Ещё две проверки
  отвергают долю, после которой точка становится нейтральным элементом группы: `:101` и `:103`.
- Ни один test не подаёт недопустимую долю: `grep -n -i "invalid\|infinity\|toThrow"
  test/contract/link-pairing.test.ts` ничего не находит. Если правка заменит `fromBytes` на
  нестрогий разбор или уберёт проверку `:101`, test-ы останутся зелёными.
- Набор P256 по RFC 9382, раздел 6, кодирует точки в несжатом виде SEC1 (65 байт, первый байт
  `0x04`). Раздел 3.2: «Applications MUST specify this encoding». `Point.fromBytes` принимает и сжатую
  точку (33 байта, первый байт `0x02` или `0x03`). Ревью проверило это скриптом: сжатая доля проходит
  `spake2Finish` без ошибки. Вреда нет: в transcript TT попадают полученные байты. Если посредник
  перекодирует долю, transcript-ы сторон разойдутся, и подтверждение ключа не сойдётся. Но код
  принимает кодировку, которую протокол не определяет.

## Что делаем

1. `spake2Finish` принимает долю другой стороны только длиной 65 байт с первым байтом `0x04`. Иначе
   — та же ошибка, что для точки вне кривой.
2. Test vector-ы: все четыре из приложения B RFC 9382. По каждому сверяются pA, pB, Ke, KcA, KcB,
   cA и cB. cA и cB сверяются на обеих сторонах. Значения берутся из текста RFC
   (https://www.rfc-editor.org/rfc/rfc9382.txt), а не считаются кодом.
3. Test-ы на недопустимую долю для `spake2Finish`, на обеих ролях:
   - точка вне кривой (изменён последний байт y);
   - длина 0, 1 байт `0x00` (кодировка нейтрального элемента в SEC1), 64 байта, 66 байт;
   - x равен модулю поля p;
   - гибридная кодировка `0x06` и `0x07`;
   - сжатая кодировка (33 байта) — после пункта 1;
   - pA = w·M для стороны B и pB = w·N для стороны A: после снятия маски точка — нейтральный элемент.
4. Один contract test через стенд `test/contract/link-bench.ts`: сторона, которая прислала
   недопустимую pA, получает закрытие с кодом 4001 (`PAIRING_CLOSE_FAILED`). B ничего не записывает,
   код сожжён и считается неудачей.

## Готово, когда

- [x] Test проверяет все четыре вектора приложения B RFC 9382; в каждом — pA, pB, Ke, KcA, KcB, cA, cB.
- [x] Каждый случай пункта 3 «Что делаем» — отдельный test, он ждёт ошибку.
- [x] Сжатая доля отвергается; test на неё был красным до правки пункта 1.
- [x] Contract test пункта 4 зелёный: закрытие 4001, у B нет записи, счётчик неудач вырос.
- [x] Mutation testing на копиях: удалить проверку `:101`, проверку длины и префикса из пункта 1,
      заменить `Point.fromBytes` на `Point.fromAffine` без проверки — каждую мутацию ловит test.
- [x] Комментарий `pairing.ts:15-18` говорит правду о векторах.

## Где в коде

- `src/main/link/pairing.ts` — `spake2Finish` (`:95-119`), разбор доли (`:97-98`), проверки
  нейтрального элемента (`:101`, `:103`), комментарий о векторах (`:15-18`).
- `test/contract/link-pairing.test.ts` — блок SPAKE2 (`:59-89`), contract test недопустимой доли.
- `test/contract/link-bench.ts` — стенд, только если ему нужен сырой WebSocket для пункта 4.

## Итог

**Сделано 2026-10-16**, ветка `worfy-link/20`, subagent `worfy:implementer` Wave worfy-link.

**Код.** `src/main/link/pairing.ts`: новая функция `peerPoint` разбирает долю другой стороны. Доля
длиной не 65 байт или с первым байтом не `0x04` отвергается до `Point.fromBytes`. Любой отказ —
точка вне кривой, координата вне поля, длина, префикс, нейтральный элемент после снятия маски —
одна и та же ошибка `pairing: the other share is invalid`. Ошибки `@noble/curves` больше не выходят
из `spake2Finish` как есть. Вторая проверка нейтрального элемента (K = 0, бывшая `:103`) получила свой
текст `pairing: the shared point K is the identity`. При secret в [1, p) она недостижима, пока
работает первая. Без отдельного текста удаление первой проверки было бы мутантом, которого не
ловит ни один test. Комментарий в начале файла говорит о всех четырёх векторах приложения B.

**Test-ы** (`test/contract/link-pairing.test.ts`).
- Четыре вектора приложения B: A='server'/B='client', ''/'client', 'server'/'', ''/''. Значения
  скопированы из текста RFC (https://www.rfc-editor.org/rfc/rfc9382.txt) скриптом разбора текста,
  без вычислений. По каждому вектору сверяются pA, pB, а также Ke, KcA, KcB, cA, cB на обеих сторонах.
- Недопустимая доля, отдельный test на каждый случай, на ролях A и B (`describe.each`): точка вне
  кривой, длина 0, байт `0x00`, 64 и 66 байт, x = p, `0x06`, `0x07`, сжатая доля, w·M для B и w·N
  для A. Каждый ждёт ошибку `pairing: the other share is invalid`. Ещё один test на роль проверяет,
  что исходная доля этих случаев принимается.
- Contract test «a first pairing message with an invalid share»: сырое pairing-соединение на стенде
  `link-bench.ts` шлёт `pake1` со сжатой pA. Ответ — закрытие 4001. У B нет связи и нет
  `linked.json`; событие `pairing-failed` одно; счётчик неудач `PairingWindow` стал 1; код сменился.
  Правка стенда не понадобилась: хватило `openLinkSocket`.

**Красный до правки.** `pnpm test test/contract/link-pairing.test.ts` до правки `pairing.ts`: EXIT=1,
19 failed / 22 passed. Test-ы на сжатую долю (A и B) упали с «expected [Function] to throw an error»:
сжатая доля проходила. Contract test упал по timeout: B принял сжатую pA и ждал `pake3`. Остальные
16 упали, потому что `@noble/curves` бросал свою ошибку, а не общую. После правки: EXIT=0, 41 passed.

**Mutation testing** (копия `pairing.ts` в scratchpad, восстановление `cp` и проверка `cmp`):
| Мутант | Результат |
| --- | --- |
| удалить `if (shared.is0())` (бывшая `:101`) | пойман: 2 test-а «a share that unblinds to the identity» (A, B) |
| удалить проверку длины и префикса | пойман: 2 test-а на сжатую долю и contract test 4001 |
| `Point.fromBytes` → `Point.fromAffine` без `assertValidity` | пойман: 2 test-а «a point off the curve» |
| `Point.fromBytes` → `Point.fromAffine` с `assertValidity` (вне списка Ticket-а) | не пойман: эквивалентный мутант, для 65 байт с `0x04` проверки те же |

Оговорка: мутант `fromAffine` без проверки всё равно бросает ошибку, но позже: `toBytes` точки K
проверяет её у `@noble/curves`. Test ловит его по тексту ошибки. Доля отвергается не при разборе, а
случайно ниже по коду.

**Проверки.** `pnpm lint && pnpm typecheck && pnpm test`: EXIT=1 из-за одного test-а
`test/contract/terminal.test.ts` (настоящий pty, timeout под нагрузкой; load average 4.2). Отдельный
повтор файла: EXIT=0, 47 passed. gate fast: EXIT=0, `[gate] зелено (fast)`.

**Ревью и merge** (PR #400, VERIFIED в первом круге, depth low). Verifier сам разобрал `rfc9382.txt`: 40 из 40 значений таблицы test-а совпали.
- Consider (долг, low): проверка «у B нет записи» (`test/contract/link-pairing.test.ts:375-376`) упасть не может — сырое соединение не шлёт `pake3`; тест держат закрытие 4001, счётчик неудач и смена кода. Сильнее — честный A со сжатой pA до `pake3`.
- Noted: свой текст ошибки у проверки K = 0 (`pairing.ts:122`) — отступление от Ticket-а, решено без владельца, подтвердить.
- Merge: `GATE_SCOPE=all` gate full на Mac зелёный, `36e11dc0`.

## Решения владельца (2026-10-16)

- Свой текст ошибки у проверки K = 0 (`pairing.ts:122`), отступление от Ticket-а: подтверждено.
