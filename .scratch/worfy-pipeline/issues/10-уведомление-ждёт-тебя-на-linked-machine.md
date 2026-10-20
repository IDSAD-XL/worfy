# 10 — Уведомление «ждёт тебя» доходит до Linked machine

Type: task
Status: claimed 2026-10-20T02:46Z
Branch: worfy-pipeline/10
Blocked by: 09
Source: follow-up Ticket-а 06 (PR #501); решение владельца 2026-10-19, Q-c: #501 влит как есть, это — отдельный
Ticket, приоритет low; решения владельца 2026-10-20, grilling Q1–Q16 (здесь Q11–Q16; [spec.md](../spec.md),
«Решения владельца», блок 2026-10-20); [ADR-0079](../../../docs/adr/0079-link-machines-announce-accepted-messages.md).
После 09: оба Ticket-а меняют `src/main/workflow/waits-notify.ts`.

## Что происходит

- Уведомление «`<epic> NN` ждёт тебя» показывает только Machine, на которой лежит Project: Ticket Project-а на
  Windows-ПК виден уведомлением только на ПК, на Mac — нет.
- Уведомления Session-ов уходят и на Linked machines: `Notifier.notify` показывает заметку у себя и шлёт её
  в `link` (`src/main/notify.ts:272-275`, `this.link?.send(note)`). Уведомления Ticket-ов идут мимо `link`:
  `installWaitsNotifications(…, new NoteDisplay<TicketNote>(…))` без него (`src/main/notify.ts:461`).
- Сообщение связи `note` описывает только Session: `sessionId` — обязательная строка
  (`src/main/link/notes.ts:27-38`), а у `TicketNote` `sessionId: null` и есть `ticket` (`src/main/notify.ts:84-90`).
  `LinkNotes.send` шлёт каждой подключённой Linked machine с уровнем доступа не Off (`notes.ts:60-63`).
- Механизма «какие сообщения понимает Machine» в `worfy-link` не было: только версия протокола с точным
  совпадением (`src/main/link/messages.ts:20`, `src/main/link/server.ts:52-54`) и `hello` без списка
  сообщений (`messages.ts:58-68`); незнакомое сообщение получатель бросает (`messages.ts:103`). Его вводит
  [ADR-0079](../../../docs/adr/0079-link-machines-announce-accepted-messages.md): поле `accepts` в `hello`.
- Клик по уведомлению Ticket-а открывает вкладку Pipeline: цель `pipeline` без Machine
  (`src/main/notify.ts:369`, `pipelineOpenSchema` — `src/shared/ipc/notify.ts:31-36`); у цели Session
  Machine есть (`notify.ts:370`). `pipeline.get` открыт Linked machines как `read`
  (`test/unit/link-access.test.ts:194-195`): окно Linked machine может показать вкладку Pipeline её Project-а.
- Id Project-а — `<имя папки>-<sha256(путь)[0:8]>` (`src/main/projects/store.ts:81-84`): у одного репозитория
  на двух Machine с разными путями id разные, поэтому «тот же Project» по id не узнать.
- Нормализованный адрес `origin` уже есть: `originKey` (`src/main/autopilot/origin.ts:17`) убирает схему,
  пользователя и порт, `.git` и `/` на конце, приводит к нижнему регистру (`git@github.com:o/r.git` и
  `https://github.com/o/r` — оба `github.com/o/r`); `readOriginKey(root)` (`:61-64`) читает его у репозитория.

## Что делаем

1. **Своё сообщение связи (Q12, ADR-0079).** Новое сообщение для заметки Ticket-а, например `ticket-note`, со
   своей схемой zod; пределы длины — как у `note`. `hello` получает `accepts` (ADR-0079, пункты 1–2);
   сообщение уходит только Machine, чей `accepts` его называет. Сборка старше уведомления не получает,
   связь с ней работает как прежде.
2. **Что несёт сообщение (Q16).** Имя и id Project-а, ключ совпадения Project-а (п. 3), `epic`, `num`, текст
   заметки и ключ ожидания (Q11, Ticket 09). Абсолютного `projectRoot` в сообщении нет: ключ совпадения —
   адрес remote и путь внутри репозитория, не локальный путь, так что Q16 соблюдён. Machine-отправителя получатель берёт из
   соединения, не из сообщения.
3. **Кто уведомляет (Q14).** Уведомляет Machine, которой принадлежит Project. Получатель бросает заметку,
   если у него в списке Project-ов есть тот же Project: его он уже уведомил сам. «Тот же Project» — тот же
   репозиторий, а не тот же путь:
   - **ключ совпадения** — `originKey` адреса `origin` репозитория Project-а и путь Project-а внутри
     репозитория (относительно корня репозитория, через `/`; корень — пустой путь), когда `origin` есть;
   - нет `origin` (или Project не в git-репозитории) — id Project-а;
   - получатель считает тот же ключ для каждого Project-а своего списка и сравнивает целиком.
   Повторы отсекает ключ (ключ совпадения, Epic, NN, ключ Q11).
4. **Кому (Q15).**
   - `Waits: owner` — все Machine владельца: эта и каждая подключённая Linked machine с уровнем Read only
     или Full access (правило `LinkNotes.send`) и с `accepts`.
   - `Waits: <имя Machine>` — только та Machine: имя этой Machine — уведомление здесь и никуда больше; имя
     Linked machine — только ей, здесь не показывается. Имя сравнивается целиком, как его показывает
     Settings → Machines.
   - `team` и `agent` — уведомления «ждёт тебя» нет нигде, как сейчас.
5. **Показ и клик (Q13).** Linked machine показывает заметку с именем Machine-отправителя. Клик открывает
   вкладку Pipeline этого Project-а на той Machine (окно Linked machine, только чтение), если окно Linked
   machine её показывает: цель `pipeline` получает Machine, как цель Session, а окно находит Project по id
   в списке Project-ов той Machine. Если не показывает — клик открывает окно worfy с этим Project-ом.
   Implementer проверяет, что есть, и записывает выбранный путь в «Итог».

## Готово, когда

- [ ] `pnpm test test/unit/notify.test.ts` — exit 0: `Waits: owner` — одна заметка у себя и одна отправка в
      stub `link`; `Waits: <имя этой Machine>` — заметка у себя, отправки нет; `Waits: <имя Linked machine>` —
      отправка только ей, у себя ничего; `team`, `agent` — ничего; приём заметки — показ с именем Machine;
      приём заметки Project-а с ключом совпадения из своего списка — показа нет; та же заметка дважды — один
      показ.
- [ ] Там же: две Machine с одним репозиторием по разным путям (`/Users/a/worfy` и `C:/src/worfy`, `origin`
      `git@github.com:o/worfy.git` и `https://github.com/o/worfy`), обе держат Project в списке, Ticket
      переходит в `Waits: owner` — одно уведомление на каждой Machine (своё), заметка другой Machine
      брошена: не два. Репозиторий без `origin` — совпадение по id Project-а.
- [ ] `pnpm test test/unit/link-notify.test.ts` — exit 0: заметка Ticket-а проходит проверку сообщения; без
      `epic`, `num`, id или ключа совпадения Project-а — отказ; поле `projectRoot` в ней не уходит, ключ
      совпадения — без локального пути; Machine без `accepts` или с
      `accepts` без имени сообщения — отправки нет.
- [ ] `test/contract/link-server.test.ts` — exit 0: `hello` с `accepts` и без него принимается; две настоящие
      link service — сообщение доходит до Machine, которая его назвала.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0. gate full — шаг Orchestrator-а перед merge.
- [ ] (вручную) Mac и ПК связаны: `ticket block <epic> <NN> "приёмка" --waits owner` на ПК — уведомление на Mac;
      клик — вкладка Pipeline Project-а ПК или окно worfy с ним, как записано в «Итог».

## Тесты

Сначала падающие случаи в `test/unit/notify.test.ts` (stub `NoteLink`), в `test/unit/link-notify.test.ts` и в
`test/contract/link-server.test.ts` (`accepts` в `hello`; рядом с test-ом `sendMessage` двух service,
`:429-431`).

## Где в коде

- `src/main/notify.ts`
- `src/main/link/notes.ts` — новое сообщение и отправка по `accepts`
- ключ совпадения Project-а — на `originKey` и `readOriginKey` (`src/main/autopilot/origin.ts`), их не копировать
- `src/main/link/messages.ts` — `accepts` в `hello`
- `src/main/link/service.ts` — `accepts` подключённой Machine: из `hello` (`onHello`, `:638`), в памяти
- `src/main/workflow/waits-notify.ts`
- `src/shared/ipc/notify.ts` — Machine в цели `pipeline`
- `src/renderer/session/notification-target.ts` — открытие цели `pipeline` в окне Linked machine
- `test/unit/notify.test.ts`
- `test/unit/link-notify.test.ts`
- `test/contract/link-server.test.ts`

## Итог

Ветка `worfy-pipeline/10`. Заметка Ticket-а уходит на Linked machines новым сообщением связи `ticket-note`
(`src/main/link/notes.ts`), только Machine, чей `hello` назвал его в `accepts` (ADR-0079).

- **`accepts` в `hello`** (`src/main/link/messages.ts`, `src/main/link/service.ts`). `hello` соединения несёт имена
  сообщений, зарегистрированных на link service (не больше 200). Список хранится в памяти на каждое соединение
  (`WeakMap` по `LinkConnection`) и заменяется каждым `hello`; `hello` без `accepts` — пустой список.
  `LinkService.accepts(machineId, message)` смотрит соединение, которое возьмёт `sendMessage`. `hello` pairing-а списка
  не несёт. Версия протокола — 3, как была.
- **Узкое прочтение 1: повторный `hello` при регистрации сообщения.** Модуль может зарегистрировать сообщение после
  того, как соединения открылись (`appNoteLink` создаёт `LinkNotes` после старта link). Тогда `registerMessage`
  шлёт `hello` ещё раз по каждому открытому соединению, иначе другая сторона не узнала бы о `ticket-note` до нового
  соединения. Сборка старше принимает второй `hello` как обновление имени (`store.touch`). ADR-0079 не правился.
- **Что несёт сообщение (Q16):** `title`, `body`, `project` (`id`, `name`, `match` — ключ совпадения), `epic`, `num`,
  `wait` (sha256 ключа Q11). Поля `projectRoot` нет; схема zod его срезает. Пределы длины — как у `note` (1000 символов
  на текст), `match` и `wait` — до 4096. Отправитель обрезает `title` и `body`, как заметку Session (`clip`, 160
  символов в одну строку), и шлёт хэш ключа ожидания: без даты-времени в `Status:` ключ содержит весь `Blocked reason`,
  и длинная причина вывела бы заметку за схему — она не дошла бы совсем. Поля `waits` в сообщении нет: получателей
  выбирает отправитель (Q15).
- **Ключ совпадения (Q14)** — `projectMatchKey` и `readProjectMatchKey` в `src/main/autopilot/origin.ts`, поверх
  `originKey`/`readOriginKey`: `["origin", <originKey>, <путь внутри репозитория через "/", корень — "">]`, без
  `origin` — `["id", <id Project-а>]`. Путь внутри репозитория — `git rev-parse --show-prefix`. `origin` без хоста
  (локальный путь `/Users/x/repo.git`, `C:\repos\x.git`, `file://`) считается отсутствующим (`remoteHasHost`): иначе
  в кадр ушёл бы путь диска (Q16). Ключ Project-а читается git-ом не чаще раза в минуту (`MATCH_KEY_TTL_MS`): смена
  `origin` видна в течение минуты.
- **Кому (Q15)** — `ticketRecipients` в `src/main/notify.ts`. `WaitsNotices` теперь отдаёт каждое ожидание человека
  (не `team`, `agent`, не пустое) с `Waits:` и ключом; решает `TicketNotes`. **Узкое прочтение 2:** имя сравнивается
  точно (с регистром), имя этой Machine проверяется раньше имён Linked machines. Пока link service не запущен, имя
  этой Machine берётся из `link/machine.json` (то, что показывает Settings → Machines). Файла нет только до первого
  старта link на этой Machine; тогда ожидание с именем Machine не показывается и не считается увиденным: следующее
  чтение Ticket-а решает снова.
- **Приём.** Получатель бросает заметку, если ключ совпадения есть у Project-а его списка. **Узкое прочтение 3:**
  повтор отсекается по (ключ совпадения, Epic, NN, ключ ожидания) на всех Machine-отправителях сразу: тот же
  Ticket от Mac и ПК показывается один раз; хранится sha256 ключа, до 10 000 штук, старые уходят первыми. **Узкое прочтение 4:**
  заголовок — `<epic> NN ждёт тебя (<имя Machine-отправителя>)`, имя — из списка Linked machines получателя по id
  соединения. Показ — по правилам `NoteDisplay` (фокус окна, 10 s), счёт по Machine, id Project-а и Ticket-у.
- **Клик (Q13) — выбран путь «вкладка Pipeline на той Machine».** Окно Linked machine показывает вкладку Pipeline
  (`pipeline.get` открыт как `read`, `invoke` окна Linked machine идёт через link). Цель `pipeline` получила
  `machineId` и `projectId` (`src/shared/ipc/notify.ts`, `projectRoot` теперь необязателен, нужен root или id);
  окно грузится на той Machine на Project с этим id (`projectToLoad`) и открывает его Pipeline (`pipelineProjectOf`,
  `src/renderer/session/notification-target.ts`). Запасной путь «окно worfy с Project-ом» не понадобился.
- **Файлы вне «Где в коде»:** `src/main/link/identity.ts` (`storedMachineName`: чтение имени без link service, файл
  при ошибке не переносится), `src/main/notify-pending.ts` (копирует поля цели `pipeline` по одному — без правки
  терял `machineId` и `projectId`), `src/renderer/canvas/overlays/NotificationTarget.tsx` (две строки: вызов
  `projectToLoad` и `pipelineProjectOf`), `test/unit/permission-card.test.tsx` (test-ы клика в окне Linked machine).
- **Test-ы:** `test/unit/notify.test.ts` (получатели, приём, дубль, две Machine с одним репозиторием по разным
  путям, без `origin`, ключ на настоящем git), `test/unit/link-notify.test.ts` (схема, две настоящие link service,
  сборка без `accepts`), `test/contract/link-server.test.ts` (`hello` с `accepts` и без, повторный `hello`),
  `test/unit/permission-card.test.tsx` (клик). Каждый новый test красный на одном из 38 mutant-ов (отчёт PR).
- **Вручную (не проверено агентом):** Mac и ПК связаны, обе сборки с этим PR — `ticket block <epic> <NN> "приёмка"
  --waits owner` на ПК даёт уведомление на Mac с именем ПК; клик открывает вкладку Pipeline Project-а ПК в окне ПК.
