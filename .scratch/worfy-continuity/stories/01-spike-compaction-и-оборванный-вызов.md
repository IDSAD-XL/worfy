# Code story — worfy-continuity 01: Spike: compaction в Claude Code и Codex, продолжение транскрипта, оборванного посреди вызова

Kind: pr · Epic: worfy-continuity · Ticket: 01 · PR: - · Language: ru

## 1. Что было не так

worfy замечал compaction только по `compact_boundary` и не знал, какие hook-и Claude Code запускает при ней, чему
следует модель, которая пишет summary, и что переживает compaction. Как Claude Code продолжает транскрипт с `tool_use`
без `tool_result`, тоже не было известно, а Ticket-ы 05, 06, 10, 11 и 12 ждут этих ответов. PR добавляет скрипт
spike-а, который запускается руками, и раздел «Итог» Ticket-а; код продукта он не меняет.

- Требование: [Что происходит](../issues/01-spike-compaction-и-оборванный-вызов.md#что-происходит)

## 2. Каждый источник инструкций оставляет свою метку

Code: `scripts/spikes/compaction/fixture/hooks/hook.mjs:46-53` · key lines: 49, 53

```js
if (event === 'SessionStart') {
  const additionalContext = [
    `Project rules (delivered by the SessionStart hook, source: ${input.source ?? 'unknown'}).`,
    'Whenever you write a summary of this conversation, include the line RULES-MARK: kestrel-17.',
  ].join('\n')
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }))
}
if (event === 'PreCompact') process.stdout.write('Include the line PRECOMPACT-MARK: osprey-23 in the summary.')
```

- Что делает: `SessionStart` отдаёт правила через `additionalContext`, как правила Harness; `PreCompact` печатает
  простой текст, который Claude Code добавляет к заданию на summary. У каждого источника своя метка, поэтому по
  `compact_summary` видно, каким источникам модель последовала.
- Почему здесь: Ticket называет `scripts/spikes/compaction/` своим местом; plugin-заглушка лежит рядом со скриптом,
  как `scripts/spikes/harness-plugin/fixture/`.
- Без него: вопрос 2 (чему следует модель, которая пишет summary) остался бы без ответа по источникам.
- Требование: [Что делаем, п. 2](../issues/01-spike-compaction-и-оборванный-вызов.md#что-делаем)
- Риски и пробелы test-ов: метки проверяются вхождением строки; модель могла бы назвать метку, не следуя
  инструкции. Test-ов у скрипта нет: он идёт руками, вне CI.

## 3. Прогон без того, что раздувает запрос

Code: `scripts/spikes/compaction/probe.ts:82-95` · key lines: 91, 92

```ts
function cleanEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(process.env)) if (!INHERITED.test(k)) env[k] = v
  return {
    ...env,
    WORFY_SPIKE_OUT: hooksOut,
    // The account's claude.ai connectors join after the first request and bring hundreds of tools:
    // on the first run they made the request after compaction 700K tokens long. Auto-memory sent
    // haiku looking for memory files it had no tool to read.
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    ...extra,
  }
}
```

- Что делает: убирает из окружения Claude Code connector-ы claude.ai и auto-memory.
- Почему здесь: первый прогон стоил 1,41 $ из общих ≈1,45 $: после compaction в запрос пришли 790 tools connector-ов,
  а слово «remember» отправило haiku искать файлы memory (раздел «Цена» в «Итоге»).
- Без него: любой следующий запуск снова платил бы за сотни tools и петлю thinking.
- Требование: [Итог, Цена](../issues/01-spike-compaction-и-оборванный-вызов.md#цена)
- Риски и пробелы test-ов: имена переменных взяты из кода Claude Code 2.1.322, а не из документации; в новой версии
  они могут исчезнуть без ошибки.

## 4. Что ушло модели после compaction — по записям запросов в транскрипте

Code: `scripts/spikes/compaction/probe.ts:338-357` · key lines: 343, 344, 349, 353

```ts
function afterCompaction(transcript: string | undefined): Facts {
  const rows = transcript ? readLines(transcript) : []
  const boundary = rows.findIndex((r) => r.type === 'system' && r.subtype === 'compact_boundary')
  if (boundary < 0) return { compacted: false }
  const shapes = new Map(rows.filter((r) => r.type === 'api-request-shape').map((r) => [r.shapeHash, r.shape as { system?: unknown; tools?: unknown[] }]))
  const shapeOf = (r: Row | undefined) => (r ? shapes.get(r.shapeHash) : undefined)
  const before = shapeOf(rows.slice(0, boundary).findLast((r) => r.type === 'api-request'))
  const after = shapeOf(rows.slice(boundary).find((r) => r.type === 'api-request'))
  const blobs = rows.slice(boundary).filter((r) => r.type === 'api-request-blob').map((r) => JSON.stringify(r.message))
  return {
    compacted: true,
    system_prompt_append_before: before ? JSON.stringify(before.system).includes(MARKS.system_prompt) : null,
    system_prompt_append_after: after ? JSON.stringify(after.system).includes(MARKS.system_prompt) : null,
    tools_before: before?.tools?.length ?? null,
    tools_after: after?.tools?.length ?? null,
    compact_rules_sent_after: blobs.some((b) => b.includes('source: compact') && b.includes(MARKS.rules)),
    summary_sent_after: blobs.some((b) => b.includes('continued from a previous conversation')),
  }
}
const mainTranscript = (sid: string | undefined) => transcriptFiles(sid).find((f) => f.endsWith(`${sid}.jsonl`))
```

- Что делает: находит первый запрос после `compact_boundary` и смотрит, есть ли в его `system` дописка к system
  prompt (вопрос 4) и ушли ли модели правила `SessionStart` с `source: compact` (вопрос 1).
- Почему здесь: ответ модели сам по себе не отличает «дописка пережила compaction» от «слово попало в summary»;
  запись запроса — отличает.
- Без него: вопрос 4 держался бы только на ответе модели.
- Требование: [Что делаем, п. 2](../issues/01-spike-compaction-и-оборванный-вызов.md#что-делаем)
- Риски и пробелы test-ов: формат записей `api-request*` внутренний и не описан в SDK; другая версия Claude Code
  может его сменить, и функция вернёт `null` вместо ответа.

## 5. Claude Code останавливают посреди вызова Bash

Code: `scripts/spikes/compaction/probe.ts:484-500` · key lines: 494, 497

```ts
async function runCutoff(): Promise<Facts> {
  const cwd = workDir('cutoff')
  const command = 'echo CUTOFF-START && sleep 20 && echo CUTOFF-END'
  const a = start(sessionOptions(cwd, { tools: ['Bash'] }))
  a.send(`This is an automated test. Run exactly this one Bash command and then tell me its output:\n${command}`)
  const toolStarted = await waitFor(() => readLines(join(hooksOut, 'hooks.jsonl')).some((h) => h.event === 'PreToolUse' && String(h.command).includes('CUTOFF-START')), 120_000)
  const startedAt = Date.now()
  // The PreToolUse hook ran; give Bash a moment to start the command, then stop Claude Code mid-call.
  await sleep(3000)
  const proc = a.child()
  const killed = proc ? proc.kill(SIGNAL) : false
  await waitFor(() => proc !== undefined && (proc.exitCode !== null || proc.signalCode !== null), 15_000)
  // Is the command Claude Code started still running without it? (`pgrep -f` matches its `sleep 20`.)
  const orphanAlive = spawnSync('pgrep', ['-f', 'sleep 20'], { encoding: 'utf8' }).status === 0
  await a.finish()
  const sid = sessionIdOf(a)
  const transcript = mainTranscript(sid)
```

- Что делает: ждёт `PreToolUse` команды со `sleep 20`, через 3 с шлёт процессу Claude Code сигнал (SIGKILL — как
  падение, SIGTERM — мягкий выход) и проверяет, жива ли команда; дальше скрипт продолжает Session через `resume`.
- Почему здесь: процесс запускает сам скрипт (`spawnClaudeCodeProcess`), чтобы его можно было убить, как при
  падении worfy.
- Без него: вопрос 6 (что видит модель после resume) остался бы без ответа.
- Требование: [Что делаем, п. 2](../issues/01-spike-compaction-и-оборванный-вызов.md#что-делаем)
- Риски и пробелы test-ов: `pgrep -f 'sleep 20'` найдёт и чужой процесс с той же строкой. Падение самого worfy, а не
  Claude Code, не моделировалось.

## 6. Как проверено

- `pnpm exec electron scripts/spikes/compaction/probe.ts manual`, `auto`, `subagent`, `cutoff`,
  `cutoff --signal SIGTERM` — exit 0, вывод в «Итоге».
- `pnpm lint` — exit 0.

## Проверить себя

1. Почему Ticket 10 берёт hook `PreCompact`, а не строку в правилах?
   - Ответ: только stdout `PreCompact` дошёл до summary Subagent-а; правила главной Session Subagent-у не передаются.
   - Строки: `scripts/spikes/compaction/fixture/hooks/hook.mjs:53`
2. Почему вопрос 4 решается по записи запроса, а не по ответу модели?
   - Ответ: метка дописки стоит и в summary, поэтому ответ модели не показывает, пережила ли дописка compaction.
   - Строки: `scripts/spikes/compaction/probe.ts:349-350`
