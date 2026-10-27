# 28 — Чат с Orchestrator: drag-and-drop файлов и превью вложений в отправленном сообщении

Type: feature
Status: done 2026-10-27T00:01Z
PR: #835
Blocked by: —
Source: владелец, 2026-10-25 (чат Mac-оркестратора). Код перечитан по main `d089cfea`.

## Что происходит

Владелец: нужен drag-and-drop файлов в чат с Orchestrator-ом и превью картинок в отправленном
сообщении; если вложение — документ, показывать плашку с форматом и именем документа, как принято.
Сейчас отправленное сообщение с приложенным файлом или статьёй показывает его путь или имя.

Факты в коде:

- Чат с Orchestrator-ом — Session view, панель справа (`<SessionView>` в `src/renderer/main.tsx:85`).
  Поле ввода — тот же `MessageInput` (`src/renderer/session/SessionView.tsx:305`), что уже умеет
  вставку картинки и drop файлов (`src/renderer/session/MessageInput.tsx:262-286`). Но drop ловит
  только рамка поля ввода `.w-composer__box` (`MessageInput.tsx:295-302`): Transcript над ним
  (`SessionView.tsx:293-304`) файл не принимает. Общего запрета drop-а на окно в коде не нашлось,
  поэтому брошенный мимо поля файл может открыться в окне вместо приложения. Session Node на Canvas принимает drop всем Node-ом
  (`src/renderer/canvas/nodes/SessionNode.tsx:149-154`, `321-367`).
- Как вложения уходят. Renderer читает байты (`src/renderer/session/attach-files.ts`) и передаёт их в
  main источником `pasted` или `dropped` (`src/shared/agent/attachments.ts:66-77`, предел 20 MB —
  `FILE_COPY_LIMIT_BYTES`, `:30`). Main (`attach`, `src/main/agent/attachments.ts:130`):
  - картинка (png, jpeg, gif, webp, до 3.75 MB — `IMAGE_LIMIT_BYTES`) уходит в Claude Code блоком
    image прямо в сообщении, base64; на диск worfy её не пишет;
  - другой файл изнутри Project-а уходит своим путём; файл снаружи копируется в
    `<data>/attachments/<uuid>/<имя>` (`copyDir`, `attachments.ts:75-79`; папка —
    `src/main/ipc/agent.ts:71`), и уходит путь копии.
- Как отправленное сообщение показано. Строка «you» в Transcript — только текст
  (`src/renderer/session/Transcript.tsx:377-384`; у элемента `prompt` в `fold.ts:40` есть только
  `text`). Текст собирает `messageLabel` (`src/shared/agent/attachments.ts:116-118`, вызов в
  `src/main/agent/session.ts:474`): текст пользователя, потом строка `Attached files: <абсолютные
  пути>` и строка `Attached images: <имена>`. Это и есть «показывает путь или имя».
- После перезапуска история читается из transcript-а Claude Code (`~/.claude/projects/…/<id>.jsonl`)
  через `parseTranscriptRecord` (`src/shared/transcript/parse.ts:126-148`): текст сообщения со
  строкой `Attached files: …` остаётся, а блок image становится событием неизвестного типа
  (`unknownType('user', 'image')`, `parse.ts:144-145`). Строки `Attached images: …` в истории нет.
- Показать картинку в renderer-е сегодня нечем: CSP (`src/renderer/index.html:5`) не задаёт
  `img-src`, поэтому действует `default-src 'self'`, а `data:`, `blob:` и свои схемы закрыты.

## Что сделать

1. **Drop на весь чат.** Файл можно бросить в любое место чата Session view — на поле ввода и на
   Transcript. Во время перетаскивания видна зона приёма (подсветка и подпись «Drop files to
   attach»). Брошенные файлы становятся chips в поле ввода, как сейчас; окно никогда не открывает
   файл вместо приложения. Отключённое поле (Session не запущена) файл не принимает и говорит
   почему.
2. **Вложения — данные сообщения, а не текст.** Событие `prompt` и элемент Transcript получают список
   вложений: `{ kind: 'image', name, mediaType, ref }` или `{ kind: 'file', name, size, ext }`. Текст
   строки «you» — только то, что набрал пользователь (`typedText`, `attachments.ts:106`). Строка
   `Attached files: …` по-прежнему уходит к Claude Code (агенту нужен путь), но в Transcript не
   показывается.
3. **Превью картинки.** В отправленном сообщении — миниатюра (например, до 160 px по длинной
   стороне, пропорции сохранены); клик открывает картинку целиком (overlay, Escape закрывает).
4. **Плашка документа.** Документ — chip с иконкой по типу (pdf, текст, код, таблица, архив, прочее),
   форматом (расширение заглавными: «PDF», «MD») и именем файла; размер — по желанию. Без путей.
5. **Превью после перезапуска. Решение: main хранит копию каждой отправленной картинки.** Файл
   `<data>/attachments/images/<sha256>.<ext>`: имя — hash байтов, поэтому та же картинка не
   хранится дважды. Читатель истории (`parse.ts`) вместо события неизвестного типа отдаёт вложение
   image с `mediaType` и тем же hash-ем (base64 не идёт в renderer); строка `Attached files: …` из
   текста истории разбирается в chips документов. Почему так: base64 картинок в каждом ответе
   истории — мегабайты по IPC, а data URL закрыт CSP. Нет копии (Session продолжена из терминала,
   копию удалили) — chip «image» с именем, без битой картинки.
6. **Показ картинки — общая схема с worfy-canvas 23.** Ticket worfy-canvas 23 (картинка на Canvas)
   вводит свой protocol для картинок из данных приложения. Предложение: одна схема на обе задачи
   (например, `worfy-image://`) с двумя корнями — картинки Canvas Project-а и
   `<data>/attachments/images/`; handler проверяет, что путь внутри корня, и отдаёт только имена из
   шаблона. Порядок: кто из двух ticket-ов вливается первым, тот вводит схему и `img-src` в CSP;
   второй добавляет свой корень.
7. **Везде одинаково.** Те же миниатюры и chips — в Transcript каждой Session (Session view и
   Session Node на Canvas), не только у Orchestrator-а.

## Вне скоупа

- Превью содержимого документа (первая страница pdf и т. п.).
- Удаление старых копий картинок из `<data>/attachments/images/` — отдельный ticket, если папка
  станет большой.

## Тесты

- unit: элемент `prompt` с вложениями даёт миниатюру и chip; текст строки «you» без
  `Attached files:` и путей; chip документа — иконка по типу, формат, имя; картинка без копии —
  chip без битой картинки; разбор истории: блок image → вложение, строка `Attached files: …` →
  chips.
- contract: копия картинки пишется в `<data>/attachments/images/<sha256>.<ext>` один раз на одни
  байты; handler схемы отказывает путям вне корня.
- e2e: бросить png и pdf на Transcript чата Orchestrator-а (не на поле ввода) — оба стали chips;
  отправить — в сообщении миниатюра и chip «PDF» с именем, путей нет; клик по миниатюре открывает
  картинку целиком; перезапуск приложения — миниатюра и chip на месте.

## Платформа

Drag-and-drop файлов и пути к ним ведут себя по-разному на macOS и Windows, поэтому PR
платформенный: вердикт Windows выбирает `scripts/windows-verdict-scope.mjs` (скрипт решает по
списку изменённых файлов, какой прогон на Windows нужен PR-у).

## Готово, когда

- [ ] Файл, брошенный на любое место чата Session view (поле ввода или Transcript), становится chip-ом;
      во время перетаскивания видна зона приёма; окно не открывает файл вместо приложения.
- [ ] Отправленное сообщение показывает миниатюры картинок и chips документов (иконка, формат, имя);
      ни абсолютных путей, ни строк `Attached files:` / `Attached images:` в Transcript нет.
- [ ] Клик по миниатюре открывает картинку целиком; Escape закрывает.
- [ ] То же — в Transcript любой Session, включая Session Node на Canvas.
- [ ] После перезапуска история показывает те же миниатюры и chips; картинка без копии — chip без
      битой картинки.
- [ ] Картинки показываются через общую с worfy-canvas 23 схему; CSP `img-src` открывает только её и
      `'self'`.
- [ ] Unit, contract и e2e из раздела «Тесты» зелёные; вердикт Windows по `windows-verdict-scope`.

## Итог

**Drop на весь чат.** Зона приёма — вся секция `w-session__main` Session view (Transcript и поле
ввода), `useChatDrop` в `src/renderer/session/chat-drop.tsx`; во время перетаскивания поверх чата
видна рамка с подписью «Drop files to attach», у Session, которая не запущена или открыта только для
чтения, — с причиной отказа. Причина показывается именно в рамке, пока файлы над чатом: курсор
показывает запрет (`dropEffect: 'none'`), и Chromium тогда вообще не присылает событие drop, так что
строке под полем ввода показать нечего. Если drop всё же придёт, поле ввода откажет и назовёт причину
под собой. С настоящим перетаскиванием из Finder это не проверялось. Брошенные файлы передаются в поле ввода через его `ref`
(`MessageInputHandle.drop`) и становятся chips, как раньше. Окно не открывает брошенный файл ни в
каком месте: `guardFileDrops` (`src/renderer/drop-guard.ts`) на `window` отменяет drop файлов, который
никто не принял. Старый drop только на рамку поля ввода (`data-dragging`) убран.

**Вложения — данные сообщения.** У событий `prompt` и `notice` (kind `user`) есть необязательный
список `attachments`: `{ kind: 'image', name, mediaType, ref }` (`ref` — sha256 байтов или `null`,
когда копии нет) или `{ kind: 'file', name, ext, size? }` (`messageAttachmentSchema`,
`src/shared/agent/attachments.ts`). Строка «you» показывает только набранный текст; путей и строк
`Attached files:` / `Attached images:` в Transcript нет. Агент по-прежнему получает строку
`Attached files: <пути>`, а теперь ещё и `Attached images: <имена>` в конце текста: так имена картинок
переживают перезапуск (в истории у блока image имени нет). `messageLabel` заменён на `messageText`.
При чтении истории строки разбираются в chips, только если они такие, какими их пишет worfy: строка
картинок — при стольких же блоках image в сообщении, строка файлов — когда все пути абсолютные.
Иначе это текст пользователя. Однозначного признака у этих строк нет: абзац
«Attached files: /абсолютный/путь», набранный руками в конце сообщения, тоже станет chip-ом. Это
только показ: chip даёт имя файла без пути и ничего не открывает. Ввести признак значило бы сменить
текст к агенту и потерять chips у уже отправленных сообщений.

**Превью.** `MessageAttachments.tsx`: миниатюра до 160 px по длинной стороне (пропорции сохраняются),
клик открывает overlay с картинкой целиком; Escape, клик или Close закрывают его, фокус
возвращается, Escape не уходит к Session (ход не прерывается). Документ — chip с иконкой по типу
(pdf, текст, код, таблица, архив, прочее; `attachment-format.ts`), форматом заглавными («PDF») и
именем; размер — пока файл под рукой, в истории его нет. Картинка, которую окно не смогло загрузить
(копии нет, ответ 404), превращается в chip «PNG имя» — битой картинки нет.

**Копии картинок.** Перед отправкой main пишет каждую картинку в
`<data>/attachments/images/<sha256>.<ext>` (`storeImages`, `src/main/agent/attachments.ts`): одна папка
на всё приложение, одна копия на одни байты, запись во временный файл и rename. Ошибка записи не
мешает отправке: она уходит в `console.error`, а строка сообщения показывает chip. Читатель истории
(`parse.ts`) отдаёт блок image как вложение с hash-ем (hash считает main, `readTranscript` передаёт
`imageRef`; base64 в renderer не идёт), строки `Attached files:` / `Attached images:` разбирает в
chips. Картинка без строки имён (Session продолжена из терминала) получает имя `image-<n>.<ext>`.
Hash считается в main при каждом чтении. Замер: около 1,7 ms на картинку в 3 MB, 30 таких картинок —
около 50 ms на одно чтение (load average около 28). Кеша нет: в коде стоит `shortcut:` с условием,
когда его добавить. Сообщение из одних вложений не даёт имени Session: заголовок берётся из первого
сообщения с текстом (`firstPrompt`, `src/main/claude-home/registry.ts`).
Удаления старых копий нет — вне скоупа.

**Схема `worfy-image://` — общая с worfy-canvas 23.** Адрес —
`worfy-image://<хранилище>[.<machine label>]/<имя файла>`: host называет хранилище и, как в
worfy-card://, машину; путь — ровно одно имя. Хранилище — папка, шаблон имён и свой лимит размера
(`ImageStore { dir, names, limit }`, `src/main/images/protocol.ts`). Сейчас хранилище одно:
`attachments` → `<data>/attachments/images/`, имена `IMAGE_FILE_NAME_PATTERN`
(`<sha256>.<ext>`, выведен из `IMAGE_EXTENSIONS` в `src/shared/agent/attachments.ts`), лимит —
лимит копии файла (`attachmentImageStore`). Адрес строят `attachmentImageUrl` и `imageHost`, разбирает
`parseImageHost` (`src/shared/images.ts`): последняя часть host, похожая на machine label (32 hex),
— машина, остальное — хранилище. Handler отдаёт файл, только если: в host нет machine label (это
картинка этой машины); хранилище известно locator-у; имя подходит под шаблон хранилища; расширение из
списка типов; ни файл, ни папка хранилища не ссылка (сравнение realpath), и ссылка на сетевую папку
Windows отсекается до realpath (`leadsToRemote`); размер не больше лимита хранилища. Всё прочее —
404, методы кроме GET/HEAD — 405; ответ с `nosniff`, `no-store` и `default-src 'none'`. Обе схемы
(`worfy-card`, `worfy-image`) регистрируются одним вызовом `registerSchemesAsPrivileged`
(`src/main/schemes.ts`): второй вызов заменил бы первый. CSP окна: `img-src 'self' worfy-image:`.

**Картинки Linked machine.** Окно на Linked machine показывает Session-ы той машины, и копии их
картинок лежат там. Поэтому окно строит адрес с machine label той машины
(`worfy-image://attachments.<machine label>/…`, `windowMachine` + `machineLabel`), а main этой машины
на такой адрес отвечает 404, и окно показывает chip картинки. Читать картинку через link — ticket
worfy-canvas 24; формат адреса для этого уже не меняется. До него в Transcript Session-ов Linked
machine вместо миниатюр — chips.

Что делает ticket 23: добавляет своё хранилище, например `canvas.<label Project-а>` →
`<папка данных Project-а>/images/` со своим шаблоном имён и своим лимитом — одна ветка в locator-е,
который передаётся в `installImageProtocol` (`src/main/index.ts`), и функция адреса рядом с
`attachmentImageUrl`. Проверки путей, заголовки, machine label и CSP уже общие.

**Session Node на Canvas.** Node показывает только последний ответ, а Transcript Session (свой
worfy и внешний) открывается в Session view — там те же миниатюры и chips (один компонент
`Transcript`). Drop на сам Node — свой, прежний (`SessionNode.tsx`), не менялся.

**Что ушло.** `messageLabel`, `registerCardScheme` (теперь `CARD_SCHEME_PRIVILEGES`), drop только на
рамку поля ввода и атрибут `data-dragging`; пути вложений в тексте Transcript, а с ними и поиск по
ним в истории. Текст к агенту для сообщения с картинкой теперь кончается строкой
`Attached images: …`, а сообщение из одних картинок несёт текстовый блок с этой строкой. Chips
очереди сообщений по-прежнему показывают текст с путями (не Transcript, вне скоупа).

**Тесты.** unit `test/unit/chat-attachments.test.tsx` (fold, store, Transcript, chips, overlay, зона
приёма, guard), `attachments.test.ts`, `session-view.test.tsx`; contract `image-protocol.test.ts`
(обход `..`, ссылки, чужой host, лимит, Windows-ссылки, одна регистрация схем, CSP),
`image-store.test.ts`, `agent-attachments.test.ts`, `transcript-parse.test.ts`,
`claude-home-registry.test.ts`; e2e `test/e2e/chat-attachments.spec.ts` (png и pdf на Transcript →
chips → миниатюра, которую окно действительно отрисовало, и chip «PDF»; overlay и Escape; перезапуск —
то же; без копии — chip; drop файла на Canvas и на sidebar отменён). Mutation testing: 36 мутантов
новых строк в первом раунде; после review — ещё 26 (оставшиеся от reviewer-а и новые строки), все
убиты.

### Ревью и merge (2026-10-27)

PR #835: ревью medium, последний круг доработки (три пункта low) — VERIFIED. Вердикт Windows — e2e
`chat-attachments.spec.ts` и `message-input-slash.spec.ts` на ПК владельца, exit 0. gate full на Mac
дважды красный на flaky test-ах вне PR (`claude-home-registry.test.ts` под нагрузкой и `harness-evals`
afterAll, который чинит worfy-polish 43); после merge #839 и rebase — зелёный, merge `1a64ff10`.
