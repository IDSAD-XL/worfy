# 125 — Pull requests читает GitHub сразу при открытии вкладки, а не ждёт таймера

Type: task
Status: done 2026-11-20T14:43Z
PR: #2092
Blocked by: none
Source: идея владельца 2026-11-19 во время приёмки pr-follow 07 («фетчить последние изменения пуллреквестов, когда
юзер заходит на вкладку pull requests»): review comment в песочнице worfy-sandbox появился в Pull requests только
через несколько минут.

Кто: агент.

## Что происходит

- PR inbox ищет PR-ы каждого Project-а по таймеру: раз в 5 минут, после ошибки интервал удваивается до 30 минут
  (`src/main/github/inbox.ts:20-22`, `INBOX_SEARCH_INTERVAL_MS` и `INBOX_MAX_INTERVAL_MS` в `inbox.ts:44-45`).
- Вне очереди читаются только Project, которого ещё не читали, или Project, у которого снова включили переключатель
  (`ensureRead`, `inbox.ts:331`), и один PR по уведомлению GitHub (`refresh(repo, number)`, `inbox.ts:22`).
- Человек открывает вкладку Pull requests, чтобы увидеть свежее состояние, а видит снимок возрастом до 5 минут, после
  ошибок — до 30.

## Что делаем

1. Открытие вкладки Pull requests (и переход в неё из Command palette или из уведомления) просит main прочитать
   Project-ы этого окна вне очереди таймера.
2. Не чаще одного чтения Project-а в 30 секунд: частые переключения вкладок не тратят лимит GitHub API. Чтение,
   которое уже идёт, не запускается второй раз — открытие ждёт его.
3. Пауза по лимиту (`RATE_LIMIT_FLOOR`, `inbox.ts:57`, до `resetAt` аккаунта) соблюдается: открытие во время паузы ничего
   не читает. Project с выключенным переключателем не читается.
4. Чтение по открытию сдвигает следующий тик таймера: через 5 минут после него, а не по старому расписанию.
5. Пока чтение идёт, вкладка показывает, что данные обновляются (то, что уже есть для «идёт чтение», если есть; новый
   индикатор — только если его нет), и время последнего чтения остаётся видно.

## Где в коде

- `src/main/github/inbox.ts` — чтение вне очереди с порогом 30 с, рядом с `ensureRead` (`:331`) и очередью `serial`.
- `src/main/ipc/pr-inbox.ts`, `src/shared/ipc/pr-inbox.ts` — запрос «прочитать сейчас» из окна (новый канал или
  параметр `prInbox.get`; решает implementer по устройству домена).
- Renderer вкладки Pull requests (`src/renderer/pr-inbox/`) — вызов при открытии вкладки.
- Test-ы: contract test PR inbox (порог 30 с, пауза по лимиту, выключенный Project, сдвиг тика, одно чтение при двух
  открытиях подряд); unit test renderer-а на вызов при открытии.
- `docs/features/pr-inbox.md` (и `docs/features/ru/pr-inbox.md`) — абзац о темпе чтения.

## Готово, когда

- [ ] Открытие вкладки Pull requests читает Project-ы окна сразу; review comment, оставленный перед открытием, виден
  без ожидания таймера.
  - evidence: test-run pass · `pnpm test:e2e test/e2e/pr-inbox.spec.ts test/e2e/pr-search.spec.ts` exit 0 · mac dev · 3eee7de269263dbe5f99e5e6017a715a5813de5b
- [ ] Два открытия за 30 с дают одно чтение; чтение во время паузы по лимиту не идёт; выключенный Project не читается.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox.test.ts` exit 0 · mac - · 3eee7de269263dbe5f99e5e6017a715a5813de5b
- [ ] Следующий тик таймера идёт через 5 минут после чтения по открытию.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/pr-inbox.test.ts` exit 0 · mac - · 3eee7de269263dbe5f99e5e6017a715a5813de5b
- [ ] Contract test-ы на каждое правило выше и unit test на вызов при открытии зелёные; CI зелёный.
  - evidence: test-run pass · `node scripts/vitest-electron.mjs test/contract/actions.test.ts test/contract/pr-inbox-approvals.test.ts test/contract/pr-inbox-notifications.test.ts test/contract/pr-inbox-send.test.ts test/contract/pr-inbox.test.ts test/contract/pr-search.test.ts test/contract/project-pulse.test.ts test/contract/stories-handler.test.ts test/contract/test-timeout-scale.test.ts test/unit/approvals-chip.test.tsx test/unit/canvas-actions.test.tsx test/unit/draft-thread.test.tsx test/unit/palette-commands.test.tsx test/unit/pipeline-board.test.tsx test/unit/pr-follow-choices.test.tsx test/unit/pr-follow-state.test.tsx test/unit/pr-follow.test.ts test/unit/pr-inbox-digest-toast.test.tsx test/unit/pr-inbox-notices.test.ts test/unit/pr-inbox-open.test.tsx test/unit/pr-inbox-view.test.tsx test/unit/pr-search-view.test.tsx test/unit/review-threads-badge.test.tsx test/unit/sidebar-section.test.tsx test/unit/pr-inbox-groups.test.ts` exit 0 · mac - · 3eee7de269263dbe5f99e5e6017a715a5813de5b
- [ ] Страница Feature `pr-inbox` (en и ru) говорит о чтении при открытии.
  - evidence: commit pass · worfy-polish/125: the Pull requests view reads GitHub at once when it is opened · - - · 3eee7de269263dbe5f99e5e6017a715a5813de5b
  - evidence: ci-check pass · https://github.com/IDSAD-XL/worfy/actions/runs/44734684242/job/136333569048 · ci - · 903e7a0a647ba0688e6d6f4c23b9862d18410e99

## Итог

- Main: `PrInbox.readOnOpen(projectId)` (`src/main/github/inbox.ts`) читает Project вне очереди таймера, через ту же
  очередь `serial` и тот же `pollIfDue` (с `now = true`), поэтому `poll` сам ставит следующий поиск через 5 минут после
  этого чтения. Правила — `openReadDue`: Project с выключенным переключателем не читается; идущее чтение не
  запускается второй раз, открытие ждёт его; не чаще одного чтения в 30 с (`INBOX_OPEN_READ_MS`) от начала последнего
  чтения Project-а — любого, по таймеру, по первому `prInbox.get` или по открытию, удачного или нет (новое поле
  `startedAt`); во время паузы аккаунта по rate limit (`accountPause`) — ничего.
- Канал: параметр `opened` у `prInbox.get` (`src/shared/ipc/pr-inbox.ts`), а не новый канал: тот же ответ — снимок, та
  же область `project`/`read`, так что открытие на Linked machine просит прочитать Project machine. Project machine
  старой версии поле отбрасывает (zod `object` его срезает) и отвечает, как раньше.
- Renderer: `ProjectPrInbox` (`PrInboxView.tsx`) следит за показанным видом (`useNavigation`, вид `pull-requests`) и при
  каждом показе зовёт `readPrInboxOnOpen` — вкладка toolbar, палитра, группа sidebar, уведомление (`openPrInboxOf`
  ставит тот же вид), смена Project-а, пока вид показан. Виды shell смонтированы всегда, поэтому mount вида не годится
  как «открытие». Пока ответ не пришёл, строка состояния пишет существующее «Reading pull requests…» и новое
  «Last read 3m ago» вместо «Next search in N min»; строки прежнего чтения остаются.
- Отбрасывание старых ответов в `usePrInbox.ts` стало «новее последнего показанного» (`applied`, `newest`) вместо
  «ответ на последний запрос»: иначе ответ обычного `prInbox.get`, отправленного перед чтением по открытию, отбрасывался
  бы, и вид нового Project-а до конца чтения GitHub стоял бы пустым.
- **Решено без владельца, подтверждено владельцем 2026-11-20**:
  - порог 30 с считается от начала любого последнего чтения Project-а, удачного или нет, а не только от чтения по
    открытию: частые переключения вкладок не тратят лимит, даже если чтение шло по таймеру;
  - после упавшего чтения (интервал удвоен, до 30 минут) открытие соблюдает это удвоение: до `nextAt` GitHub не
    спрашивается. Ticket называет только паузу по rate limit; удвоение добавлено по брифу («respect the existing
    backoff»). Цена: после 401 пользователь, починивший вход, ждёт следующего тика или Health check-а (его перепроверка
    идёт своим путём);
  - параметр `opened` у `prInbox.get` вместо нового канала (причина — выше);
  - индикатор чтения — только в виде Pull requests и только для чтения по открытию: чтения по таймеру строку не
    меняют, как и раньше; снимок main нового поля не получил.
- Test-ы: 7 contract test-ов в `test/contract/pr-inbox.test.ts` (сразу читает; сдвиг тика; 30 с; два открытия подряд —
  одно чтение; пауза rate limit; удвоение после сбоя; выключенный Project) и один на канал `prInbox.get` с `opened` —
  все 8 были красными до правки (exit 1). 4 unit test-а в `test/unit/pr-inbox-view.test.tsx` (скрытый вид не просит,
  каждый показ просит; вход `openPrInboxOf` и смена Project-а; строка чтения и время последнего чтения; отказ main) —
  красные до правки (exit 1). e2e `test/e2e/pr-inbox.spec.ts` «opening the view reads GitHub at once…»: новый review
  comment к #118 после поиска, часы main +60 с, открытие вкладки — comment виден за ≤ 10 с (×множитель), поиск ровно
  один; уход и возврат сразу — поиска нет. Красным до правки этот e2e не запускался.
- Страницы `docs/features/pr-inbox.md` и `docs/features/ru/pr-inbox.md`: абзац «Reading on opening» / «Чтение при
  открытии» и строка об очереди в «How it works».
