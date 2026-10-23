# 16 — Assist-процесс регистрируется в `~/.claude/sessions`, и spare может остаться без закрытия при отмене

Type: task
Status: done 2026-10-23T02:34Z
PR: #793
Branch: worfy-terminal-ai/16
Blocked by: —
Source: live-проверка Ticket-а [09](09-приёмка-worfy-terminal-ai.md) 2026-10-19, пункт 3 «Готово, когда» ([evidence](../evidence/09-live-проверка.md)); spec, «Риски», пункт 4 («Пишет ли Claude Code с `persistSession: false` файл в `sessions/` — не проверено»); [ADR-0058](../../../docs/adr/0058-terminal-ai-assist-process.md), пункт 2

## Что происходит

Live-проверка 09 записала два дефекта. Разбор по коду показал: оба наблюдения — про другой процесс.

- Процесс 52480 (жил 45+ минут, запись `sessions/52480.json` с `cwd` в корне Project-а и
  `messagingSocketPath`) — **Session worfy, не assist-процесс**. Его argv: `--model opus`,
  `--resume=<id>`, `--add-dir <папка cards worfy>`, `--settings {"autoCompactWindow":400000}` — опции
  Session-а (`src/main/agent/options.ts:195-199`, `:338`). Assist-процесс стартует с
  `settingSources: []`, без MCP и моделью haiku или sonnet (`src/main/terminal-ai/options.ts:58-79`,
  `:89-98`). «Два assist-процесса сразу» — один spare (60702) и эта Session. Spare закрылся сам после
  10 минут без запросов: в 18:30 и 18:36 детей `claude` у worfy, кроме Session, нет.

Что настоящее, по коду:

1. **Assist-процесс всё же пишет в `~/.claude/sessions` и открывает messaging socket.**
   - `persistSession: false` (`src/main/terminal-ai/options.ts:69`) выключает только транскрипты в
     `~/.claude/projects`: SDK передаёт его как `--no-session-persistence`
     (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs:134`; описание опции —
     `sdk.d.ts:1810-1817`). Регистрацию сессии он не трогает.
   - SDK прямо пишет, что регистрация сессии ждёт claim: «What waits for the claim: the working
     directory, SessionStart hooks, session registration…» (`sdk.d.ts:2768-2770`). В Claude Code 2.1.289
     (бинарник `claude-agent-sdk-darwin-arm64/claude`, разбор по `strings`) обработчик `claim_session`
     вызывает запись pid-файла `sessions/<pid>.json` с полями `cwd`, `kind`, `name`,
     `messagingSocketPath`; файл удаляется на выходе процесса. Запись пропускается, только когда
     процесс — агент команды или «child session» (`CLAUDE_CODE_CHILD_SESSION` с маркером;
     `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE` её возвращает). Документированной опции SDK, которая
     выключает запись, **не найдено**.
   - Spare ещё до claim публикует ключ своего messaging socket: `sessions/60702.<hash>.key` был на
     месте, пока 60702 жил, и исчез после выхода. Socket лежит в `/tmp/cc-socks/<pid>.sock`, вне
     `CLAUDE_CONFIG_DIR`.
   - Что это значит. `cwd` записи — `<WORFY_DATA_DIR>/terminal-ai` (`options.ts:92`), не Project:
     пункт 09 «нет записи assist-процесса с `cwd` в Project-е» по букве выполняется, и worfy assist на
     Canvas не показывает (`src/main/claude-home/registry.ts`). Но на время запроса assist-процесс
     виден другим сессиям Claude Code как живая сессия, и они могут слать ему сообщения в socket.
     Вживую `<pid>.json` assist-а не пойман: он живёт секунды, от claim до выхода. Это не проверено.

2. **Spare без владельца, если отмена приходит в узкое окно** (`src/main/terminal-ai/assist.ts:440-442`).
   `fly()` ждёт `this.abortable(this.take(signal), signal)`. `take()` (`:647-655`) после старта spare
   проверяет `signal.aborted`, очищает слот (`this.spare = null`) и возвращает spare. Если отмена
   приходит после этой проверки, но раньше, чем `abortable()` (`:485-501`) получит значение,
   `abortable()` отвечает `ABORTED`, и spare теряется. Его нет в слоте: `dropSpare()` (`:669-673`),
   idle-timer (`:657-667`) и `dispose()` его не видят, а `finally { spare.close() }` (`:466-468`) ещё не
   действует. Процесс живёт до выхода worfy. Окно — между microtask-ами одной цепочки. Отменить в нём
   может только продолжение другого запроса (`this.current?.controller.abort('cancelled')`, `:409`).
   Вживую не воспроизведено, live-наблюдение 09 им не объясняется. Других путей, где spare остаётся
   жить, по коду **не найдено**.

## Что делаем

1. Окно отмены (`assist.ts:440-442`): если `abortable()` ответил `ABORTED`, spare, который `take()`
   вернёт позже, закрыть (`void taken.then((spare) => spare?.close())`) или очищать слот в одном месте
   с проверкой отмены. Spare, который `take()` оставил в слоте при отмене, остаётся следующему запросу,
   как сейчас.
2. Регистрация в `~/.claude/sessions` — развилка, к владельцу при claim. Варианты:
   - (а) принять и записать в spec («Риски», пункт 4) и в «Итог»: запись живёт от claim до выхода,
     `cwd` — вне Project-ов, worfy её не показывает;
   - (б) отдельный `CLAUDE_CONFIG_DIR` для assist-процессов в `prewarmOptions()`. Записи и `.key`
     уходят из `~/.claude`, socket в `/tmp/cc-socks` остаётся. Не проверено: найдёт ли Claude Code вход
     по подписке. На macOS он лежит в Keychain, и имя записи может зависеть от папки конфигурации;
   - (в) недокументированный `CLAUDE_CODE_CHILD_SESSION`. Он меняет и другое поведение Claude Code, его
     может убрать любое обновление. Рекомендация исполнителя — не брать;
   - (г) просьба к Claude Code / Agent SDK об опции «не регистрировать сессию» для spare.
   Рекомендация исполнителя — (а) сейчас и (г), (б) — если владелец хочет, чтобы `~/.claude/sessions`
   не менялся вовсе, и замер покажет, что вход по подписке работает.

   **Тот же выбор — для процесса Limits** (заметка 2026-10-20, ревью PR #543, `worfy-ui` 18).
   `src/main/agent/limits-usage.ts` (приходит с #543) раз в 30 мин спрашивает у Claude Code расход
   плана через Agent SDK `query()` с `persistSession: false` и `cwd` = папка assist-процессов
   (`assistDir`). Transcript он не пишет, но регистрируется в `~/.claude/sessions` так же: `kind`
   interactive, статус idle, с socket-ом для сообщений между сессиями, около 0,3 с на запуск, до 48 раз
   в сутки. Другие сессии Claude Code в это время видят его и могут прислать ему сообщение. Ответ
   владельца по пункту 2 применяется к обоим файлам, а при варианте (б) временный `CLAUDE_CONFIG_DIR`
   нужен и в `usageOptions()` (`limits-usage.ts`).

## Готово, когда

- [x] Contract test (`test/contract/terminal-ai-assist.test.ts`, stand-in SDK из этого файла): отмена
      запроса в момент, когда spare только что выдан, — этот spare закрыт (`closed === true`), в слоте
      не больше одного живого spare. Test красный на коде до правки пункта 1.
- [x] Contract test времени жизни spare на stand-in SDK и fake timers: последовательность Suggestion-ов
      с отменами, Next command, Command request и Fix. После того как все запросы завершились, живых
      stand-in процессов не больше одного (spare); после `IDLE_MS` — ни одного; после `dispose()` —
      ни одного.
- [x] Ответ владельца по пункту 2 записан в «Итог». Если выбран (б): test запускает настоящий
      бинарник Claude Code с временными `CLAUDE_CONFIG_DIR` и `HOME`, без входа (prewarm и claim; модель
      не вызывается, подписка не тратится), и проверяет, что во временной `sessions/` нет `<pid>.json`
      и `<pid>.*.key` с `cwd` в Project-е. Обычный `~/.claude/sessions` до и после test-а одинаковый.
      Под vitest настоящая фабрика бросает: test запускает бинарник сам и стоит отдельно, вне `pnpm test`,
      либо явно разрешён. Если выбран (а): в spec, «Риски», пункт 4, записан ответ «пишет, от claim до
      выхода, `cwd` вне Project-а».
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` — exit 0.

## Ответ владельца 2026-10-23

- **Пункт 1, окно отмены** (`assist.ts:440-442`): исправить. Spare, который `take()` вернул после того,
  как `abortable()` ответил `ABORTED`, закрывается. Spare, который при отмене остался в слоте, остаётся
  следующему запросу, как сейчас. Test — с mutant-ом.
- **Пункт 2, запись в `~/.claude/sessions`**: вариант (а). Принять и записать в spec («Риски», пункт 4)
  и в «Итог»: запись живёт от claim до выхода, `cwd` — вне Project-ов, worfy её не показывает. Тот же
  выбор — для процесса Limits (`src/main/agent/limits-usage.ts`), записать и там. Без (б) отдельного
  `CLAUDE_CONFIG_DIR`, без (в) `CLAUDE_CODE_CHILD_SESSION` и без (г): просьбу к Claude Code владелец
  не хочет, черновик не пишется.

## Где в коде

- `src/main/terminal-ai/assist.ts` (`:440-442`, `take()` `:647-655`, `dropSpare()` `:669-673`).
- `src/main/terminal-ai/options.ts` (`:58-79`) — только при варианте (б).
- `src/main/agent/limits-usage.ts` (`usageOptions()`; файл приходит с PR #543) — только при варианте (б).
- `test/contract/terminal-ai-assist.test.ts`
- `.scratch/worfy-terminal-ai/spec.md` — «Риски», пункт 4.

## Итог

- **Окно отмены закрыто.** `fly()` (`src/main/terminal-ai/assist.ts:440-455`) держит promise `take()`;
  если `abortable()` ответил `ABORTED`, spare, который `take()` вернёт позже, закрывается
  (`void taken.then((orphan) => orphan?.close(), () => undefined)`). Если `take()` увидел отмену сам, он
  возвращает `null` и оставляет spare в слоте — следующему запросу, как раньше.
- **Test-ы** (`test/contract/terminal-ai-assist.test.ts`, раздел «races and shutdown»):
  - «closes a spare handed out just before a cancel, and keeps one a cancel finds still in the slot» —
    отмена проходит microtask за microtask-ом от старта spare до claim. У каждой точки один из трёх
    исходов, строго по порядку: spare ещё в слоте и остаётся следующему запросу (`kept`); `take()` уже
    выдал его — он закрыт без claim, в слоте новый spare (`orphan`); он уже claimed и закрыт полётом
    (`claimed`). Test требует, чтобы были все три, `orphan` в том числе, и чтобы в каждом исходе живым
    оставался ровно один spare в слоте, а после `dispose()` — ни одного. Красный на коде до правки.
  - «leaves at most the spare alive after Suggestions with cancels, Next command, Command request and
    Fix…» — после последовательности живой только spare, после `IDLE_MS` — ни одного, после нового
    запроса и `dispose()` — ни одного.
- **Mutation testing** (mutant-ы в своём worktree, восстановление из копии): без закрытия
  `taken` — красный первый новый test; закрытие и spare в слоте (`dropSpare()`) — красные он же и
  «keeps the spare a cancelled Suggestion was waiting for…»; `take()` при отмене отдаёт spare из слота,
  а `fly()` его закрывает — красный первый новый test (после замечания ревью: раньше его ловили
  только два старых); без `spare.close()` в `finally` — красные
  новый test и «stops before claim()…»; `warm()` без повторного использования слота — красные 7 test-ов,
  среди них оба новых; idle-timer без закрытия spare — красные 3, среди них test времени жизни.
- **Пункт 2 — вариант (а), принятый риск.** Ответ записан в spec, «Риски», пункт 4: Claude Code пишет
  `sessions/<pid>.json` от claim до выхода процесса, `cwd` — `<WORFY_DATA_DIR>/terminal-ai`, вне
  Project-ов, worfy запись не показывает. Тот же ответ — для процесса Limits. Комментарии в коде у
  `persistSession: false`: `src/main/terminal-ai/options.ts` и шапка `src/main/agent/limits-usage.ts`.
  Отдельного `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_CHILD_SESSION` и просьбы к Claude Code нет.
- **Low, принято без правки:** ключ messaging socket (`sessions/<pid>.<hash>.key`) spare публикует ещё
  до claim, поэтому он лежит в `~/.claude/sessions`, пока spare ждёт запроса, — до `IDLE_MS` (10 минут)
  после последнего запроса. Это часть того же принятого риска (а); в spec записано.
- **Low, принято без правки:** обработчик отказа у `taken.then(…, () => undefined)` защитный: `take()`
  сейчас не бросает (`warm()` ловит ошибки старта), он нужен, чтобы будущий отказ не стал unhandled
  rejection.
- Проверка: `pnpm lint && pnpm typecheck && pnpm test` — exit 0 (410 файлов, 8798 test-ов); gate fast —
  exit 0, `[gate] green (fast)`.
