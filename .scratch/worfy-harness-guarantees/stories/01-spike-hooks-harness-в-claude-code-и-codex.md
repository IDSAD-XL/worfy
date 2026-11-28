# Code story — worfy-harness-guarantees 01: Spike: hooks Harness в Claude Code и Codex

Kind: pr · Epic: worfy-harness-guarantees · Ticket: 01 · PR: - · Language: ru

## 1. Что было не так

Ticket-ы 03, 06, 07, 08 и 09 строят на поведении Claude Code, которого никто не проверял на binary закреплённой
версии SDK (0.3.322): что приходит в `plugins` и `plugin_errors` `system/init`, срабатывает ли PreToolUse на Edit и
Write в `bypassPermissions`, каким полем отличить Subagent, спрашивает ли `permissionDecision: "ask"` человека. Код
продукта PR не меняет: он несёт ответы в «Итог» Ticket-а, скрипт опыта и fixture `system/init`.

- Требование: [Что происходит](../issues/01-spike-hooks-harness-в-claude-code-и-codex.md#что-происходит)

## 2. Stand-in, который ведёт цепочку вызовов на разговор

Code: `scripts/spikes/harness-hooks/probe.ts:139-152` · key lines: 143, 145, 146, 147

```ts
      const messages = Array.isArray(json.messages) ? (json.messages as Block[]) : []
      const tools = Array.isArray(json.tools) ? (json.tools as Block[]).map((t) => String(t.name)) : []
      const first = textOf(messages[0]?.content)
      requests.push({ system: textOf(json.system), first, tools })
      const chain = chains.find((c) => first.includes(c.marker))
      if (chain !== undefined && tools.length > 0) {
        const answered = new Set(messages.flatMap((m) => (Array.isArray(m.content) ? (m.content as Block[]) : []).filter((b) => b.type === 'tool_result').map((b) => String(b.tool_use_id))))
        const next = chain.calls.find((c) => !answered.has(c.id))
        if (next !== undefined && tools.includes(next.name)) {
          answerTool(res, next)
          return
        }
      }
      answerText(res, json.stream === true, 'done')
```

- Что делает: узнаёт разговор (главный поток или Subagent) по метке в его первом сообщении и отдаёт следующий
  вызов его цепочки, на который ещё нет `tool_result`, если запрос предлагает этот tool; иначе — текст `done`.
- Почему здесь: Ticket велит гонять Claude Code только против stand-in Messages API (`Что строить`), а stand-in
  contract test-ов (`test/contract/messages-api-stand-in.ts`, его Ticket разрешает только читать) пишет один
  tool_use на весь прогон. Write Subagent-а — два вызова в двух разговорах: Agent у главного потока, Write у
  Subagent-а. Окружение то же — `claudeEnv` импортирован из файла contract test-ов.
- Без него: Subagent получил бы только текст, и вопросы 3 и 6 (hook Subagent-а, ход Subagent-а в `claude -p`)
  остались бы без ответа.
- Требование: [Что строить, п. 3 и 6](../issues/01-spike-hooks-harness-в-claude-code-и-codex.md#что-строить)
- Риски и пробелы test-ов: скрипт — spike, test-а на него нет; ESLint и `test/unit/no-rmsync.test.ts` его читают,
  `tsc` — нет (`scripts/spikes/` нет в `tsconfig`).

## 3. Копии Harness для `system/init`

Code: `scripts/spikes/harness-hooks/probe.ts:285-300` · key lines: 287, 288, 293, 298

```ts
  const variants: [string, string][] = [
    ['intact', harnessCopy('intact', () => undefined)],
    ['broken-hooks-json', harnessCopy('broken-hooks-json', (dir) => writeFileSync(join(dir, 'hooks', 'hooks.json'), '{ "hooks": { "PreToolUse": [ '))],
    ['missing-hook-script', harnessCopy('missing-hook-script', (dir) => unlinkSync(join(dir, 'hooks', 'guard.mjs')))],
    [
      'engines-unmet',
      harnessCopy('engines-unmet', (dir) => {
        const path = join(dir, '.claude-plugin', 'plugin.json')
        writeFileSync(path, JSON.stringify({ ...(JSON.parse(readFileSync(path, 'utf8')) as Block), engines: { 'claude-code': '>=99.0.0' } }, null, 2))
      }),
    ],
    ['engines-met', harnessCopy('engines-met', (dir) => {
      const path = join(dir, '.claude-plugin', 'plugin.json')
      writeFileSync(path, JSON.stringify({ ...(JSON.parse(readFileSync(path, 'utf8')) as Block), engines: { 'claude-code': `>=${binary.claudeCodeVersion}` } }, null, 2))
    })],
  ]
```

- Что делает: делает пять копий `harness/` — целую, с `hooks.json`, который не разбирается, без `hooks/guard.mjs`
  (команда PreToolUse `Bash|apply_patch`) и с `engines["claude-code"]` выше и равным версии binary; каждую грузит
  inline-plugin-ом, делает один Bash и пишет `system/init` в `init-plugin-errors.jsonl`.
- Почему здесь: Ticket просит копию Harness со сломанным `hooks.json` и отдельно с отсутствующим скриптом
  (`Что строить`, п. 1) и проверку `engines` (п. 5); почему сломан именно `guard.mjs`, не записано.
- Без него: Ticket 03 не знал бы, что `plugin_errors` называет plugin именем папки (`harness-broken-hooks-json@inline`),
  а не `worfy`, и что пропавший скрипт hook-а в `system/init` не виден.
- Требование: [Что строить, п. 1 и 5](../issues/01-spike-hooks-harness-в-claude-code-и-codex.md#что-строить)
- Риски и пробелы test-ов: plugin проверен только inline (`plugins: [{type: 'local'}]`); имя в `plugin_errors` у
  plugin-а, установленного из marketplace, не снято.

## 4. `ask` из hook-а при `bypassPermissions` и `canUseTool`

Code: `scripts/spikes/harness-hooks/probe.ts:414-428` · key lines: 419, 421, 423, 427

```ts
      `ask-${name}`,
      [{ marker: 'ASK-PROBE', calls: [{ id: 'toolu_write_ask', name: 'Write', input: { file_path: file, content: 'asked\n' } }] }],
      'ASK-PROBE',
      {
        plugins: [{ type: 'local', path: plugin }],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        canUseTool: async (toolName, input, opts) => {
          asked.push({ toolName, input, decisionReason: (opts as unknown as Block).decisionReason, title: (opts as unknown as Block).title })
          return answer === 'allow' ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'spike: denied by the human' }
        },
      },
      undefined,
      { PROBE_DECISION: 'ask' },
    )
```

- Что делает: hook plugin-а отвечает на Write `permissionDecision: "ask"` (`PROBE_DECISION`), Session идёт в
  `bypassPermissions`, а `canUseTool` записывает каждый вызов и отвечает `deny` или `allow`.
- Почему здесь: Ticket спрашивает, зовёт ли Claude Code человека через `canUseTool` SDK (`Что строить`, п. 4);
  ответ выбирает ветку Q2 (в) для Ticket-а 06.
- Без него: Ticket 06 выбирал бы ветку по предупреждению SDK «canUseTool will not be invoked», а опыт показал
  обратное: после `ask` `canUseTool` вызван, `deny` не дал записать файл.
- Требование: [Что строить, п. 4](../issues/01-spike-hooks-harness-в-claude-code-и-codex.md#что-строить)
- Риски и пробелы test-ов: проверен Write в главном потоке; `ask` внутри Subagent-а не снят.

## 5. Fixture и его строка в README

Code: `test/fixtures/sdk-messages/README.md:30-30` · key lines: 30

```md
| `init-plugin-errors.jsonl` | Снят spike-ом worfy-harness-guarantees/01 (2026-11-28, `scripts/spikes/harness-hooks/probe.ts init-errors --fixtures test/fixtures/sdk-messages`; без модели и без входа: stand-in Messages API, `claudeEnv` из `test/contract/messages-api-stand-in.ts`). Пять `system/init` — копия `harness/` inline-plugin-ом по порядку: целая; `hooks/hooks.json` не разбирается как JSON (единственная строка с `plugin_errors`: `type: hook-load-failed`, `plugin` — имя папки копии с `@inline`, не имя `worfy` из манифеста; строка `plugins` при этом есть); нет скрипта `hooks/guard.mjs` (`plugin_errors` нет); `engines: {"claude-code": ">=99.0.0"}` и `engines` с версией binary (`plugin_errors` нет: Claude Code поле не знает). Встроенные плагины (`path: builtin`) из `plugins` убраны, `messaging_socket_path` — `<redacted>`. Что значит каждая строка — «Итог» тикета. |
```

- Что делает: описывает новый `init-plugin-errors.jsonl` — чем снят, пять `system/init` по порядку и что в
  каждом, что обезличено.
- Почему здесь: Ticket называет fixture и строку в `test/fixtures/sdk-messages/README.md` (`Где в коде`). К нему же
  добавлена запись событий в `test/fixtures/sdk-events/claude.json`: `test/unit/claude-events.test.ts` требует её
  для каждого файла `sdk-messages/*.jsonl` в том же PR (комментарий `:1-6`); Ticket этого файла не называет.
- Без него: Ticket 03 разбирал бы `plugin_errors` без записанного потока; без записи событий `pnpm test` красный
  (`has a record of the events before the move for every recorded file`).
- Требование: [Где в коде](../issues/01-spike-hooks-harness-в-claude-code-и-codex.md#где-в-коде)
- Риски и пробелы test-ов: `test/contract/sdk-compat.test.ts` сверяет только `claude_code_version` и формы
  сообщений; `plugin_errors` worfy пока не читает (`src/shared/vendors/claude/events.ts:25-33`) — это Ticket 03.

## 6. Что сознательно не меняли

- Код продукта, `test/contract/messages-api-stand-in.ts` и `harness/` — Ticket разрешает их только читать.
- Настоящий Codex не запускался: вопрос 8 отвечен по `test/fixtures/codex-messages/hooks/`.

## 7. Как проверено

- `node scripts/spikes/harness-hooks/probe.ts` по сценариям `init-errors`, `listing`, `edit-hooks`, `ask`, `cli`,
  `claude-home` — exit 0 каждый; повтор `init-errors --fixtures test/fixtures/sdk-messages` дал тот же файл
  (`git diff` пуст).
- `pnpm test test/contract/sdk-compat.test.ts test/unit/claude-events.test.ts test/unit/no-rmsync.test.ts` — exit 0.
- `pnpm lint && pnpm typecheck && pnpm test` — exit 0; gate fast — exit 0.

## Проверить себя

1. Почему stand-in contract test-ов не годится для вопроса о hook-е Subagent-а?
   Ответ: Он пишет один tool_use на прогон, а Write Subagent-а требует двух вызовов в двух разговорах — Agent у
   главного потока и Write у Subagent-а; stand-in spike-а отдаёт цепочку на разговор по метке первого сообщения.
   Lines: `scripts/spikes/harness-hooks/probe.ts:139-152`
2. Что делает Claude Code с `permissionDecision: "ask"` в `bypassPermissions`, когда у SDK есть `canUseTool`?
   Ответ: Зовёт `canUseTool` с `decisionReason` из hook-а, несмотря на предупреждение SDK; `deny` — файл не записан.
   Lines: `scripts/spikes/harness-hooks/probe.ts:414-428`

## 8. Что нашёл review и что осталось

> VERIFIED — worfy-harness-guarantees 01 (spike: Claude Code hooks via SDK 0.3.322 binary against a scripted Messages API stand-in, Codex hook fixtures; answers Q1–Q8 in «Итог», fixture init-plugin-errors.jsonl, scripts/spikes/harness-hooks/probe.ts), head e6f5839f2d84846b420b9ba78a53829921997bf6
>
> Review depth low, one reviewer, lens correctness. The reviewer reran every probe scenario (init-errors, listing, edit-hooks, ask, cli, claude-home): each gave the facts in «Итог» (Q1 hook-load-failed under the folder name@inline; Q3 agent_id marks a Subagent, agent_type also on the --agent main thread; Q4 ask in bypassPermissions calls canUseTool, deny writes nothing). Fixture regenerated byte-identical, no personal paths. Not verified, marked in «Итог»: Codex Delete File / Move to forms, Write into memory/.
> Commands: pnpm lint 0, pnpm typecheck 0, claude-events + sdk-compat tests 0, probe runs 0.
