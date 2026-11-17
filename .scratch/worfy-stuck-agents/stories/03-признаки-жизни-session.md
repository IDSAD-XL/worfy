# Code story — worfy-stuck-agents 03: Признаки жизни Session: время последнего признака и тишина хода

Kind: pr · Epic: worfy-stuck-agents · Ticket: 03 · PR: - · Language: ru

## 1. Что было не так

Session не помнила, когда её агент в последний раз что-то делал: `onEvent` только переводил состояние и раздавал
событие. Работа, которую worfy не показывает, не давала событий вовсе: у Claude Code `hook_started`, `hook_progress`
и `thinking_tokens` отбрасывались, у Codex признаком был только Stop hook. Поэтому зависший ход нельзя было отличить
от долгого.

- Требование: [Что происходит](../issues/03-признаки-жизни-session.md#что-происходит)

## 2. Правило тишины — чистая функция

Code: `src/shared/agent/quiet.ts:42-47` · key lines: 43, 45, 46

```ts
export function quietFor(now: number, facts: QuietFacts, thresholdMs: number = QUIET_MARK_MS): number {
  if (facts.state !== 'busy' || facts.openHooks > 0 || facts.e2eLockHeld) return 0
  const outside = [facts.taskOutputAt, facts.gateOutputAt].filter((at): at is number => at !== null)
  if (outside.some((at) => now - at < thresholdMs)) return 0
  return Math.max(0, now - Math.max(facts.lastSignAt, ...outside))
}
```

- Что делает: отвечает, сколько миллисекунд ход без признаков жизни. Ноль, если Session не `busy` (в том числе
  `needs_permission`), если идёт hook, если e2e lock держит живой holder или если output file background task-и либо
  вывод gate-а изменились в пределах порога. Иначе считает от самого позднего из последнего события и изменений файлов.
- Почему здесь: Ticket называет новый модуль `src/shared/agent/quiet.ts` и функцию `quietFor(now, facts)`; функция без
  часов и файлов, поэтому все исключения проверяются unit test-ом.
- Без него: решение «тишина или работа» было бы размазано по Session, и исключения нельзя было бы проверить без
  настоящих файлов и часов.
- Требование: [Что делаем, п. 3 и 4](../issues/03-признаки-жизни-session.md#что-делаем)
- Риски и пробелы test-ов: функция возвращает миллисекунды, а не минуты, как сказано в Ticket-е: минуты считает тот,
  кто показывает (Ticket 06). Файл, который перестал расти раньше порога, считается признаком на время своего
  изменения — это решение реализации, в Ticket-е не записано.

## 3. Скрытые признаки жизни у обоих driver-ов

Code: `src/shared/vendors/claude/events.ts:173-177` · key lines: 175, 177

```ts
    case 'hook_started':
    case 'hook_progress':
      return [{ type: 'alive', hook: { id: read(sdkHookRun, message).hook_id, phase: 'running' } }]
    case 'thinking_tokens':
      return [{ type: 'alive', hook: null }]
```

- Что делает: сообщения Claude Code, которые раньше отбрасывались, дают событие `alive`; у hook-а — с id его run-а,
  чтобы Session знала, какой hook ещё идёт. `hook_response` теперь всегда даёт `alive` с `ended`, а строку `hook` —
  как раньше, только если hook что-то сказал. Codex (`src/main/vendors/codex/items.ts`, `hookStarted` и
  `hookCompleted`) даёт такие же события на начало и конец любого hook run-а, не только Stop.
- Почему здесь: Ticket называет оба файла driver-ов и места, где события отбрасывались.
- Без него: долгий hook (gate в TaskCompleted идёт до 900 с) и долгое рассуждение выглядели бы тишиной.
- Требование: [Что делаем, п. 2](../issues/03-признаки-жизни-session.md#что-делаем)
- Риски и пробелы test-ов: `alive` — событие только для main (`isMainOnlyEvent`), Session его не раздаёт; запись
  `test/fixtures/sdk-events/claude.json` переписана в этом PR, потому что перевод изменился намеренно.

## 4. Session помнит последний признак и раз в минуту смотрит на ход

Code: `src/main/agent/session.ts:1240-1287` · key lines: 1241, 1247, 1264, 1271, 1281

```ts
  private signOfLife(event: AgentEvent): void {
    this.lastSignAt = this.quietWatch.now()
    this.signs += 1
    if (event.type === 'alive' && event.hook !== null) {
      if (event.hook.phase === 'running') this.openHooks.add(event.hook.id)
      else this.openHooks.delete(event.hook.id)
    }
    this.unquiet()
  }

  /** The turn is no longer quiet: sends `quiet` null when it was. */
  private unquiet(): void {
    if (this.quietSinceValue === null) return
    this.quietSinceValue = null
    this.emit({ type: 'quiet', quietSince: null })
  }

  /**
   * Whether the running turn went quiet (quietFor, src/shared/agent/quiet.ts): first by the agent's events
   * alone, and only when they say so by the files outside them too. Sends `quiet` when the mark is reached,
   * and `quiet` null when a file shows the turn at work again.
   */
  private async look(): Promise<void> {
    if (this.lookBusy || this.stateValue !== 'busy') return
    const facts = { state: this.stateValue, lastSignAt: this.lastSignAt, openHooks: this.openHooks.size, taskOutputAt: null, gateOutputAt: null, e2eLockHeld: false }
    if (quietSince(this.quietWatch.now(), facts, this.quietWatch.markMs) === null) return
    const signs = this.signs
    const live = new Set(this.liveTaskList.map((task) => task.taskId))
    const taskOutputs = new Map([...this.taskOutputFiles].filter(([taskId]) => live.has(taskId)))
    this.lookBusy = true
    try {
      const outside = await this.quietWatch.outside({ cwd: this.cwd, taskOutputs })
      // A sign of life or another state meanwhile has decided already.
      if (this.signs !== signs || this.stateValue !== 'busy' || this.closing) return
      const since = quietSince(this.quietWatch.now(), { ...facts, ...outside }, this.quietWatch.markMs)
      if (since === null) {
        this.unquiet()
        return
      }
      if (since === this.quietSinceValue) return
      this.quietSinceValue = since
      this.emit({ type: 'quiet', quietSince: since })
    } catch (error) {
      console.warn(`[agent] could not tell whether ${this.current} went quiet`, error)
    } finally {
      this.lookBusy = false
    }
  }
```

- Что делает: каждое событие агента — признак жизни: оно двигает `lastSignAt`, считает начатые и кончившиеся hook-и и
  сбрасывает пометку событием `quiet` с `null`. Пока ход идёт, Session раз в минуту (`QUIET_LOOK_MS`) смотрит: если по
  одним событиям ход молчит дольше порога, она читает файлы вне событий и только тогда шлёт `quiet` с `quietSince`.
  Признак, пришедший пока читались файлы, отменяет решение этого взгляда.
- Почему здесь: Ticket называет `session.ts` и `onEvent` как место, где запоминается время событий; порог и частота —
  из пунктов 4 и 5 Ticket-а («не чаще раза в минуту»).
- Без него: renderer не узнал бы о тишине, а Ticket-ы 04, 06 и 09 не на что было бы опереть.
- Требование: [Что делаем, п. 1 и 5](../issues/03-признаки-жизни-session.md#что-делаем)
- Риски и пробелы test-ов: чтение файлов в приложении (`src/main/agent/session/quiet-signs.ts`) проверено unit
  test-ами на временных файлах; путь к e2e lock-у берётся из Profile-а через `bin/profile` и в test-ах подменён.
  `quietSince` отдаёт и `agent.controls`, чтобы окно, открытое позже, знало о пометке.

## 5. Что сознательно не меняли

Chip, hint line и Restart — Ticket 06; тишина Subagent-а — Ticket 04; `turn-hung` в Autopilot — Ticket 09. Страница
`docs/features/sessions.md` не правится: поле пока не видно человеку (решено без владельца, пункт 12).

## 6. Как проверено

`pnpm lint`, `pnpm typecheck` — exit 0. Новые и изменённые test-ы: `test/unit/session-quiet.test.ts`,
`test/unit/claude-events.test.ts`, `test/unit/codex-items.test.ts`, `test/contract/agent-session.test.ts`,
`test/contract/codex-session.test.ts` — exit 0; оба contract test-а краснеют, если Session не шлёт `quiet` или не
сбрасывает его на событии агента. `gate fast` — exit 0, `[gate] green (fast)`.

## Проверить себя

1. Почему Session читает файлы только когда по событиям ход уже молчит дольше порога?
   - Ответ: чтение файлов и Profile-а дороже взгляда на счётчики; пока события идут, ход точно жив, и файлы ничего не
     добавят.
   - Строки: `src/main/agent/session.ts:1264`, `src/main/agent/session.ts:1271`
2. Что будет с пометкой, если пока Session читает файлы, пришло событие агента?
   - Ответ: счётчик признаков изменился, и взгляд выходит без решения: пометку не ставит устаревшее чтение.
   - Строки: `src/main/agent/session.ts:1242`, `src/main/agent/session.ts:1273`
3. Почему молчащий hook не даёт тишину, хотя событий нет?
   - Ответ: его начало добавило id run-а в открытые hook-и, и `quietFor` возвращает ноль, пока не придёт его конец.
   - Строки: `src/main/agent/session.ts:1244`, `src/shared/agent/quiet.ts:43`
