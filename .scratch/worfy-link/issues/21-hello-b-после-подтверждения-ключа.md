# 21 — Сведения о Machine B уходят только после подтверждения ключа

Type: task
Status: done — 2026-10-16, [PR #403](https://github.com/IDSAD-XL/worfy/pull/403)
Blocked by: —
Source: долг ревьюера PR #154 (`.scratch/worfy-link/issues/01-сервер-связи-machine-ов.md:370`), подтверждён
независимым ревью SPAKE2, Ticket [17](17-независимое-ревью-spake2.md), находка Н3 (low)

## Что происходит

- Pairing — связывание двух Machine (компьютеров с worfy) по 6-значному коду — идёт четырьмя
  сообщениями `pake1`–`pake4` (`src/main/link/pairing.ts:237-243`). Machine B показывает код, на
  Machine A его вводят.
- B отвечает на первое сообщение A сообщением `pake2`: своя доля SPAKE2 pB, своё подтверждение ключа
  cB и `machine` — сведения о себе (`pairing.ts:241`, отправка — `:412`). Это схема `hello`
  (`src/main/link/messages.ts:51-59`): id, имя машины, версия протокола, сборка worfy, порт сервера.
- B отправляет `pake2` до того, как A доказала знание кода: подтверждение A (cA) приходит позже, в
  `pake3` (`:414-415`).
- Поэтому любой, кто видит B в сети, пока на ней открыт «Link a machine», узнаёт её имя, сборку, порт
  и id. Для этого он шлёт `pake1` со случайной долей. Цена — один сожжённый код и одна из десяти
  неудач подряд (`PAIRING_MAX_FAILURES`, `pairing.ts:143`).
- A отдаёт свои сведения только в `pake3`, после проверки cB (`:372-377`). Стороны несимметричны.

## Что делаем

- В `pake2` B шлёт только pB и cB. Свои сведения B отдаёт в `pake4`, после проверки cA.
- Проверку A «этот id уже связан с другим сертификатом» (`checkPeer`, `pairing.ts:338-346`; в
  сервисе — `checkPeerId`, `src/main/link/service.ts:487-496`) A делает по `pake4`, до записи связи.
  Токен, который A выдала B в `pake3`, без записи у A ничего не открывает: A хранит только его хэш, и
  только после `commit`.
- Развилка: формат `pake2`–`pake4` меняется, и Machine со старой и новой сборкой не свяжутся.
  Рекомендация: поднять `LINK_PROTOCOL_VERSION` (`src/main/link/messages.ts:13`). Тогда старая сборка
  получит понятный отказ по версии, а не «код не подошёл». Решает владелец при claim.

## Готово, когда

- [x] Contract test: сторона, которая шлёт `pake1` без кода, получает `pake2` без имени, сборки, порта
      и id B.
- [x] Contract test: A отказывает B, чей id связан с другим сертификатом, и ничего не записывает. Так
      же работает test `link-pairing.test.ts:369` после переноса проверки.
- [x] Остальные test-ы `test/contract/link-pairing.test.ts` зелёные.
- [x] Решение по версии протокола записано в «Итог».

## Где в коде

- `src/main/link/pairing.ts` — схемы `pake2`–`pake4` (`:237-243`), `initiatePairing` (`:349-383`),
  `respondToPairing` (`:389-427`), `checkPeer` (`:338-346`).
- `src/main/link/messages.ts` — `LINK_PROTOCOL_VERSION` (`:13`), если версия поднимается.
- `test/contract/link-pairing.test.ts`.
- `test/contract/link-server.test.ts`, `test/contract/link-access.test.ts` — ожидания, которые зависят от
  `LINK_PROTOCOL_VERSION` (добавлено при claim: версия поднимается).

## Итог

Ветка `worfy-link/21`.

**Порядок сообщений pairing теперь такой** (`src/main/link/pairing.ts`, схемы `pake1`–`pake6`):

1. `pake1` A→B: доля pA.
2. `pake2` B→A: только pB и cB. Сведений о B (id, имя, сборка, порт) в нём нет.
3. `pake3` A→B: cA, сведения об A, токен A для B. A шлёт его после проверки cB, как раньше.
4. `pake4` B→A: сведения о B и токен B для A. B шлёт его после проверки cA и своей проверки id A.
5. `pake5` A→B: A приняла B. Перед ним A делает `checkPeer` по сведениям из `pake4`: «нельзя
   связать с собой» и «id уже связан с другим сертификатом» (`checkPeerId` в сервисе не менялся).
6. B записывает связь и шлёт `pake6`. Только после `pake6` A записывает связь.

**Почему сообщений шесть, а не четыре.** Тикет предполагал, что A проверит B по `pake4` и сразу
запишет связь. Но B записывала связь до `pake4`. Значит, при отказе A у B оставалась бы запись об A:
существующий test «A refuses a server…» требует, чтобы у B ничего не было. Обратный порядок (A
записывает первой, B — по закрытию сокета) ломается иначе. A сразу после связи звонит B
(`connections.ts`, событие `linked`), и если B ещё не записала токен, B отвечает 401. На 401 A
забывает B (`service.ts`, `connect`, ветка `unauthorized`). Поэтому B записывает первой, по
`pake5`, а A — по `pake6`. Это тот же порядок записи, что был до тикета: B, затем A.

**Токен из `pake3` без записи у A ничего не открывает.** A хранит хэш токена только в `commit`, а
`commit` на A идёт после `pake6`. Test «A refuses a server that claims the id…» берёт токен из `pake3`,
проверяет, что его хэша нет ни в одном файле A, и входит с ним на A через `/link/connect`. A отвечает
401 (`unauthorized`).

**Версия протокола — решено без владельца, подтвердить.** `LINK_PROTOCOL_VERSION` поднята с 1 до 2
(`src/main/link/messages.ts`). Сборка с протоколом 1 получает отказ по версии ещё до handshake:
«worfy link protocol mismatch: … speaks link protocol 2, the connecting worfy speaks 1». Сообщения
«код не подошёл» она не увидит. Код B при этом не сгорает и неудача не считается: test «refuses a
worfy of link protocol 1…». Цена: уже связанные Machine-ы с разными сборками не соединятся и через
`/link/connect`, пока обе не обновятся. Версия общая для всего протокола связи. В обнаружении
Bonjour Machine старой сборки помечается несовместимой.

**Test-ы** (`test/contract/link-pairing.test.ts`):

- «a side without the code gets pake2 with pB and cB only, and after a wrong cA nothing more» —
  сторона без кода шлёт `pake1`, получает `pake2` ровно с ключами `t`, `pB`, `cB`. После неверного
  cA B закрывает сокет с 4001 и больше ничего не шлёт.
- «a pairing carries B's details in pake4, after A's confirmation, and A's in pake3» — порядок
  `pake1`–`pake6`, id B только в `pake4`, id A только в `pake3`.
- «A refuses a server that claims the id of a Machine linked with another certificate» — отказ A по
  `pake4`: сообщения идут до `pake4`, `pake5` не уходит; ни A, ни B ничего не записали; токен из
  `pake3` даёт 401.
- «refuses a worfy of link protocol 1…» — отказ по версии.
- `link.ping` и test отказа по версии в `link-server.test.ts` и `link-access.test.ts` теперь берут
  версию из `LINK_PROTOCOL_VERSION`.

Мутанты, каждый краснеет: сведения о B снова в `pake2`; нет `checkPeer` по `pake4`; B не ждёт
`pake5`; A не ждёт `pake6`; версия осталась 1.

Проверки: `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (264 файла, 5599 test-ов);
gate fast — `[gate] зелено (fast)`, exit 0.

Не проверено: соединение двух настоящих Machine-ов по сети, только стенд
`test/contract/link-bench.ts`. Если связь рвётся между записью у B и `pake6`, у B остаётся
запись без пары у A. Так же было и до тикета, между записью у B и `pake4`. Первый звонок B к A
получит 401, и B сама забудет A.

**Ревью и merge** (PR #403, VERIFIED в первом круге, depth low). Свой мутант verifier-а «B записывает до `pake5`» краснит ровно `link-pairing.test.ts:587`.
- Noted: обрыв между записью у B и `pake6` оставляет у B запись без пары у A — то же окно, что до Ticket-а (между записью у B и `pake4`); лечится само: B звонит A, получает 401 и забывает A (`service.ts:378-379`). Test-а нет.
- Версия протокола 2: уже связанные Machine-ы с разными сборками не соединятся, пока обе не обновлены; старая сборка получает 400 с обеими версиями, связь не забывается.
- Merge: `GATE_SCOPE=all` gate full на Mac зелёный, `35480d1a`.
