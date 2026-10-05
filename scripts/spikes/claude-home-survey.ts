// Read-only survey of the Claude Code home directory (~/.claude) for ticket worfy-mvp/09.
//
// It answers: what is in the session registry (sessions/<pid>.json), how a cwd maps to a
// projects/<dir> name, which record types each Claude Code version writes, how subagent
// transcripts link to the Agent tool call, where `ticket claim`, skill calls and gate.sh output
// show up, and how large the data is. Findings are written up in the ticket's "Итог" section.
//
// Run:   node scripts/spikes/claude-home-survey.ts [--home <dir>] [--project-prefix <dir-prefix>] [--sdk]
//        node scripts/spikes/claude-home-survey.ts --skeleton <file.jsonl> [--max <n>]
//
// Nothing here writes to disk: files are only opened for reading, and the one child process is
// `ps`. `--skeleton` prints the structure of a transcript to stdout (keys, numbers, booleans and
// enum-like values kept, every other string replaced by its length), which is how the shapes in
// test/fixtures/claude-home/ were checked. sessions/*.key files are never opened.
// `--sdk` also times the read-only session readers of @anthropic-ai/claude-agent-sdk
// (listSessions, getSessionMessages, listSubagents) against the default ~/.claude.

import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Rec = { [key: string]: Json }

const args = process.argv.slice(2)
const argValue = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const home = argValue('--home') ?? join(homedir(), '.claude')
const auctionPrefix = argValue('--project-prefix') ?? '-Users-alexey-Work-Auction'
const userHome = homedir()

const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

const bump = (map: Map<string, number>, key: string, by = 1): void => {
  map.set(key, (map.get(key) ?? 0) + by)
}

const sorted = (map: Map<string, number>): [string, number][] => [...map].sort((a, b) => b[1] - a[1])
const top = (map: Map<string, number>, n = 15): Record<string, number> => Object.fromEntries(sorted(map).slice(0, n))
const mb = (bytes: number): string => `${(bytes / 1e6).toFixed(1)} MB`
const short = (path: string): string => path.replace(userHome, '~')

const listDir = async (dir: string): Promise<string[]> => {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

const isDir = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

// Claude Code names a project folder by replacing every character outside [A-Za-z0-9] with '-'.
// The survey checks this guess against the cwd recorded inside each transcript.
const projectDirName = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-')

// ---------------------------------------------------------------------------------------------
// 1. Session registry: sessions/<pid>.json

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// `procStart` in the registry is the process start time as `ps -o lstart=` prints it in UTC.
// Comparing it guards against pid reuse after the session process exited.
const processStartUtc = (pid: number): string | undefined => {
  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' },
      encoding: 'utf8',
    })
    return out.trim().replace(/\s+/g, ' ')
  } catch {
    return undefined
  }
}

const surveySessions = async (): Promise<void> => {
  const dir = join(home, 'sessions')
  const names = await listDir(dir)
  const keyFiles = names.filter((n) => n.endsWith('.key')).length
  const jsonFiles = names.filter((n) => /^\d+\.json$/.test(n))
  const fieldCount = new Map<string, number>()
  const values: Record<string, Map<string, number>> = {
    kind: new Map(),
    entrypoint: new Map(),
    status: new Map(),
    nameSource: new Map(),
    version: new Map(),
  }
  let alive = 0
  let startMatches = 0
  for (const name of jsonFiles) {
    const raw: unknown = JSON.parse(await readFile(join(dir, name), 'utf8'))
    if (!isRecord(raw)) continue
    for (const key of Object.keys(raw)) bump(fieldCount, key)
    for (const [field, map] of Object.entries(values)) bump(map, String(raw[field] ?? '<absent>'))
    const pid = Number(raw.pid)
    if (pidAlive(pid)) {
      alive += 1
      const started = processStartUtc(pid)
      if (started !== undefined && started === String(raw.procStart).replace(/\s+/g, ' ')) startMatches += 1
    }
  }
  console.log('## 1. sessions/<pid>.json')
  console.log(`files: ${jsonFiles.length} json, ${keyFiles} .key (not opened)`)
  console.log(`pid alive: ${alive}/${jsonFiles.length}; procStart == ps lstart in UTC: ${startMatches}/${alive}`)
  console.log('fields (files having it):', Object.fromEntries(sorted(fieldCount)))
  for (const [field, map] of Object.entries(values)) console.log(`${field}:`, Object.fromEntries(sorted(map)))
}

// ---------------------------------------------------------------------------------------------
// 2–4. Transcripts

// A record's "kind" is its type plus the most telling sub-discriminator.
const recordKind = (r: Rec): string => {
  const type = String(r.type)
  if (type === 'system' && typeof r.subtype === 'string') return `system/${r.subtype}`
  if (type === 'attachment' && isRecord(r.attachment)) return `attachment/${String(r.attachment.type)}`
  if ((type === 'user' || type === 'assistant') && isRecord(r.message)) {
    const content = r.message.content
    if (typeof content === 'string') return `${type}/text`
    if (Array.isArray(content) && content.length > 0 && isRecord(content[0])) return `${type}/${String(content[0].type)}`
  }
  return type
}

type Stats = {
  files: number
  bytes: number
  records: number
  badLines: number
  largest: { path: string; bytes: number }
  kindsByVersion: Map<string, Map<string, number>>
  recordsByVersion: Map<string, number>
  filesByVersionCount: Map<string, number>
  titleSources: Map<string, number>
  agentCalls: number
  agentResults: Map<string, number>
  agentLink: Map<string, number>
  taskNotifications: number
  taskNotificationTags: Map<string, number>
  ticketCommands: Map<string, number>
  skillCalls: Map<string, number>
  slashCommands: Map<string, number>
  invokedSkills: number
  gate: Map<string, number>
  withGitBranch: number
  withCwd: number
}

const newStats = (): Stats => ({
  files: 0,
  bytes: 0,
  records: 0,
  badLines: 0,
  largest: { path: '', bytes: 0 },
  kindsByVersion: new Map(),
  recordsByVersion: new Map(),
  filesByVersionCount: new Map(),
  titleSources: new Map(),
  agentCalls: 0,
  agentResults: new Map(),
  agentLink: new Map(),
  taskNotifications: 0,
  taskNotificationTags: new Map(),
  ticketCommands: new Map(),
  skillCalls: new Map(),
  slashCommands: new Map(),
  invokedSkills: 0,
  gate: new Map(),
  withGitBranch: 0,
  withCwd: 0,
})

const textOf = (v: Json | undefined): string => {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => textOf(x)).join('\n')
  if (isRecord(v)) return Object.values(v).map((x) => textOf(x)).join('\n')
  return ''
}

const GATE_OUTPUT = /\[gate\]/
const TICKET = /(?:^|[\s/;&|(])ticket\s+(claim|done|block|open)\b/

// Where the subagent transcript for an agentId lives, relative to one main transcript.
type AgentIndex = { own: Set<string>; project: Set<string> }

type FileInfo = { firstCwd?: string; anyCwdMatches: boolean; sessionIds: Set<string>; agentToolUseIds: Set<string> }

const scanTranscript = async (
  path: string,
  stats: Stats,
  agents: AgentIndex | undefined,
  projectDir: string,
): Promise<FileInfo> => {
  const size = (await stat(path)).size
  stats.files += 1
  stats.bytes += size
  if (size > stats.largest.bytes) stats.largest = { path, bytes: size }
  const agentToolUseIds = new Set<string>()
  const info: FileInfo = { anyCwdMatches: false, sessionIds: new Set(), agentToolUseIds }
  const titles = new Set<string>()
  const versions = new Set<string>()
  let sawUserText = false
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    if (line.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      stats.badLines += 1
      continue
    }
    if (!isRecord(parsed)) continue
    const r = parsed
    stats.records += 1
    const version = typeof r.version === 'string' ? r.version : '<no version field>'
    if (typeof r.version === 'string') versions.add(r.version)
    const byVersion = stats.kindsByVersion.get(version) ?? new Map<string, number>()
    bump(byVersion, recordKind(r))
    stats.kindsByVersion.set(version, byVersion)
    bump(stats.recordsByVersion, version)
    if (typeof r.sessionId === 'string') info.sessionIds.add(r.sessionId)
    if (typeof r.gitBranch === 'string') stats.withGitBranch += 1
    if (typeof r.cwd === 'string') {
      stats.withCwd += 1
      info.firstCwd ??= r.cwd
      if (projectDirName(r.cwd) === projectDir) info.anyCwdMatches = true
    }

    if (r.type === 'custom-title' || r.type === 'ai-title' || r.type === 'summary' || r.type === 'agent-name') {
      titles.add(String(r.type))
    }
    const content = isRecord(r.message) ? r.message.content : undefined
    if (r.type === 'user' && r.isMeta !== true && typeof content === 'string' && !sawUserText) {
      sawUserText = true
      titles.add('first user text')
    }

    if (r.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (!isRecord(block) || block.type !== 'tool_use') continue
        const input = isRecord(block.input) ? block.input : {}
        const name = String(block.name)
        if (name === 'Agent' || name === 'Task') {
          stats.agentCalls += 1
          if (typeof block.id === 'string') agentToolUseIds.add(block.id)
        }
        if (name === 'Bash' && typeof input.command === 'string') {
          const m = TICKET.exec(input.command)
          if (m) bump(stats.ticketCommands, `ticket ${m[1]}`)
          if (input.command.includes('gate.sh')) bump(stats.gate, 'assistant tool_use Bash command runs gate.sh')
        }
        if (name === 'Skill' && typeof input.skill === 'string') bump(stats.skillCalls, input.skill)
      }
    }

    if (r.type === 'user') {
      const text = typeof content === 'string' ? content : ''
      const cmd = /<command-name>\/?([^<]+)<\/command-name>/.exec(text)
      if (cmd?.[1] !== undefined) bump(stats.slashCommands, cmd[1])
      if (text.includes('<task-notification>')) {
        stats.taskNotifications += 1
        for (const tag of new Set([...text.matchAll(/<([a-z][a-z-]*)>/g)].map((m) => m[1] ?? ''))) {
          bump(stats.taskNotificationTags, tag)
        }
      } else if (GATE_OUTPUT.test(text)) {
        bump(stats.gate, 'user text message')
      }
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block) || block.type !== 'tool_result') continue
          if (GATE_OUTPUT.test(textOf(block.content))) bump(stats.gate, 'user tool_result content')
          if (typeof block.tool_use_id !== 'string' || !agentToolUseIds.has(block.tool_use_id)) continue
          const result = r.toolUseResult
          if (!isRecord(result)) continue
          bump(stats.agentResults, `status=${String(result.status)}`)
          if (typeof result.agentId !== 'string' || agents === undefined) continue
          if (agents.own.has(result.agentId)) bump(stats.agentLink, 'own session subagents/')
          else if (agents.project.has(result.agentId)) bump(stats.agentLink, 'another session of the same project dir')
          else bump(stats.agentLink, 'not found')
        }
      }
    }

    if (r.type === 'attachment' && isRecord(r.attachment)) {
      const a = r.attachment
      if (a.type === 'invoked_skills') stats.invokedSkills += 1
      if (typeof a.command === 'string' && a.command.includes('gate')) bump(stats.gate, `attachment ${String(a.type)} (gate hook command)`)
      for (const field of ['stdout', 'stderr', 'content']) {
        if (typeof a[field] === 'string' && GATE_OUTPUT.test(a[field])) bump(stats.gate, `attachment ${String(a.type)}.${field}`)
      }
    }
    if (r.type === 'system') {
      if (GATE_OUTPUT.test(textOf(r.content)) || GATE_OUTPUT.test(textOf(r.hookErrors))) {
        bump(stats.gate, `system ${String(r.subtype)}`)
      }
      if (r.subtype === 'stop_hook_summary' && textOf(r.hookInfos).includes('stop.sh')) {
        bump(stats.gate, 'system stop_hook_summary lists stop.sh (no output kept)')
      }
    }
  }
  for (const t of titles) bump(stats.titleSources, t)
  if (titles.size === 0) bump(stats.titleSources, '<none>')
  bump(stats.filesByVersionCount, String(versions.size))
  return info
}

// ---------------------------------------------------------------------------------------------
// Subagent files: <sessionId>/subagents/agent-<id>.{jsonl,meta.json} and, for agents started by
// a workflow script, <sessionId>/subagents/workflows/wf_<id>/agent-<id>.{jsonl,meta.json}.

type AgentFile = { id: string; jsonl: string; meta?: Rec; inWorkflow: boolean }

const listAgentFiles = async (sessionDir: string): Promise<AgentFile[]> => {
  const out: AgentFile[] = []
  const collect = async (dir: string, inWorkflow: boolean): Promise<void> => {
    for (const name of await listDir(dir)) {
      const id = /^agent-(.+)\.jsonl$/.exec(name)?.[1]
      if (id === undefined) continue
      let meta: Rec | undefined
      try {
        const raw: unknown = JSON.parse(await readFile(join(dir, `agent-${id}.meta.json`), 'utf8'))
        if (isRecord(raw)) meta = raw
      } catch {
        meta = undefined
      }
      out.push({ id, jsonl: join(dir, name), meta, inWorkflow })
    }
  }
  const subagents = join(sessionDir, 'subagents')
  await collect(subagents, false)
  for (const wf of await listDir(join(subagents, 'workflows'))) await collect(join(subagents, 'workflows', wf), true)
  return out
}

const surveyProjects = async (): Promise<string | undefined> => {
  const root = join(home, 'projects')
  const projectDirs = (await listDir(root)).filter((n) => !n.startsWith('.'))
  const main = newStats()
  const sub = newStats()
  const auction = { main: 0, mainBytes: 0, sub: 0, subBytes: 0, largest: 0 }
  const metaFields = new Map<string, number>()
  const spawnDepth = new Map<string, number>()
  const requestShape = new Map<string, number>()
  const sessionChildren = new Map<string, number>()
  let workflowAgents = 0
  let withoutMeta = 0
  let parentFound = 0
  let parentMissing = 0
  let sessionsWithAgents = 0
  let duplicateAgentFiles = 0
  // meta.json toolUseId -> where the spawning Agent tool_use was found.
  const spawnLink = new Map<string, number>()
  const dirRule = { files: 0, firstCwdMatches: 0, anyCwdMatches: 0, cwdShapes: new Map<string, number>() }
  const started = performance.now()

  for (const projectDir of projectDirs) {
    const dir = join(root, projectDir)
    if (!(await isDir(dir))) continue
    const entries = await listDir(dir)
    const sessions = entries.filter((e) => e.endsWith('.jsonl')).map((e) => basename(e, '.jsonl'))
    const agentsBySession = new Map<string, AgentFile[]>()
    const projectAgentIds = new Set<string>()
    for (const sessionId of sessions) {
      const sessionDir = join(dir, sessionId)
      if (await isDir(sessionDir)) for (const child of await listDir(sessionDir)) bump(sessionChildren, child)
      const files = await listAgentFiles(sessionDir)
      agentsBySession.set(sessionId, files)
      for (const f of files) {
        if (projectAgentIds.has(f.id)) duplicateAgentFiles += 1
        projectAgentIds.add(f.id)
      }
    }
    const isAuction = projectDir.startsWith(auctionPrefix)
    for (const sessionId of sessions) {
      const path = join(dir, `${sessionId}.jsonl`)
      const files = agentsBySession.get(sessionId) ?? []
      const info = await scanTranscript(path, main, { own: new Set(files.map((f) => f.id)), project: projectAgentIds }, projectDir)
      if (info.firstCwd !== undefined) {
        dirRule.files += 1
        if (projectDirName(info.firstCwd) === projectDir) dirRule.firstCwdMatches += 1
        if (info.anyCwdMatches) dirRule.anyCwdMatches += 1
        if (info.firstCwd.includes('.')) bump(dirRule.cwdShapes, 'dot')
        if (info.firstCwd.includes(' ')) bump(dirRule.cwdShapes, 'space')
        if ([...info.firstCwd].some((ch) => ch.charCodeAt(0) > 127)) bump(dirRule.cwdShapes, 'non-ASCII')
      }
      if (isAuction) {
        const size = (await stat(path)).size
        auction.main += 1
        auction.mainBytes += size
        auction.largest = Math.max(auction.largest, size)
      }
      if (files.length > 0) sessionsWithAgents += 1
      const mainToolUseIds = info.agentToolUseIds
      const ids = new Set(files.map((f) => f.id))
      const toolUseIdsByAgent = new Map<string, Set<string>>()
      for (const f of files) {
        if (f.inWorkflow) workflowAgents += 1
        if (f.meta === undefined) withoutMeta += 1
        else {
          for (const key of Object.keys(f.meta)) bump(metaFields, key)
          bump(spawnDepth, String(f.meta.spawnDepth ?? '<absent>'))
          bump(requestShape, String(f.meta.requestShape ?? '<absent>'))
          if (typeof f.meta.parentAgentId === 'string') {
            if (ids.has(f.meta.parentAgentId)) parentFound += 1
            else parentMissing += 1
          }
        }
        const agentInfo = await scanTranscript(f.jsonl, sub, { own: ids, project: projectAgentIds }, projectDir)
        toolUseIdsByAgent.set(f.id, agentInfo.agentToolUseIds)
        if (isAuction) {
          auction.sub += 1
          auction.subBytes += (await stat(f.jsonl)).size
        }
      }
      for (const f of files) {
        const toolUseId = f.meta?.toolUseId
        const parent = f.meta?.parentAgentId
        if (typeof toolUseId !== 'string') bump(spawnLink, f.inWorkflow ? 'no toolUseId (workflow agent)' : 'no toolUseId')
        else if (mainToolUseIds.has(toolUseId)) bump(spawnLink, 'Agent tool_use in the main transcript')
        else if (typeof parent === 'string' && toolUseIdsByAgent.get(parent)?.has(toolUseId)) {
          bump(spawnLink, 'Agent tool_use in the parent agent transcript (parentAgentId)')
        } else bump(spawnLink, 'not found in this session')
      }
    }
  }
  const elapsed = performance.now() - started

  console.log('\n## 2. projects/<dir>/<sessionId>.jsonl')
  console.log(`project dirs: ${projectDirs.length}; main transcripts: ${main.files} (${mb(main.bytes)}, ${main.records} records, ${main.badLines} unparsable lines)`)
  console.log(
    `dir name = cwd with [^A-Za-z0-9] -> '-': first cwd matches in ${dirRule.firstCwdMatches}/${dirRule.files} files, ` +
      `some cwd matches in ${dirRule.anyCwdMatches}/${dirRule.files}; first-cwd shapes:`,
    Object.fromEntries(dirRule.cwdShapes),
  )
  console.log('entries inside <sessionId>/:', Object.fromEntries(sorted(sessionChildren)))
  console.log('title sources (main transcripts having it):', Object.fromEntries(sorted(main.titleSources)))
  console.log('distinct versions per main transcript:', Object.fromEntries(sorted(main.filesByVersionCount)))
  const versions = [...main.recordsByVersion].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  console.log('main records by version:', Object.fromEntries(versions))
  for (const [version, total] of versions) {
    const kinds = sorted(main.kindsByVersion.get(version) ?? new Map())
      .slice(0, 14)
      .map(([k, n]) => `${k} ${((100 * n) / total).toFixed(1)}%`)
      .join(', ')
    console.log(`  ${version} (${total}): ${kinds}`)
  }
  const allKinds = new Map<string, Set<string>>()
  for (const [version, kinds] of main.kindsByVersion) {
    for (const kind of kinds.keys()) allKinds.set(kind, (allKinds.get(kind) ?? new Set()).add(version))
  }
  const versionCount = main.kindsByVersion.size
  console.log(
    'kinds not seen in every version:',
    [...allKinds].filter(([, vs]) => vs.size < versionCount).map(([k, vs]) => `${k} (${vs.size}/${versionCount})`).join(', '),
  )

  console.log('\n## 3. Subagents')
  console.log(
    `sessions with agent files: ${sessionsWithAgents}; agent transcripts: ${sub.files} (${mb(sub.bytes)}), ` +
      `of them started by workflow scripts: ${workflowAgents}; without meta.json: ${withoutMeta}; ` +
      `agent file ids repeated in another session of the same project: ${duplicateAgentFiles}`,
  )
  console.log('meta.json fields:', Object.fromEntries(sorted(metaFields)))
  console.log('spawnDepth:', Object.fromEntries(sorted(spawnDepth)), 'requestShape:', Object.fromEntries(sorted(requestShape)))
  console.log(`parentAgentId resolves inside the same session: ${parentFound}, does not: ${parentMissing}`)
  console.log('meta.toolUseId -> spawning tool_use.id:', Object.fromEntries(sorted(spawnLink)))
  console.log(`Agent tool_use in main transcripts: ${main.agentCalls}; results:`, Object.fromEntries(sorted(main.agentResults)))
  console.log('  toolUseResult.agentId -> agent-<agentId>.jsonl:', Object.fromEntries(sorted(main.agentLink)))
  console.log(
    `Agent tool_use in subagent transcripts: ${sub.agentCalls}; results:`,
    Object.fromEntries(sorted(sub.agentResults)),
    'link:',
    Object.fromEntries(sorted(sub.agentLink)),
  )
  console.log(`task-notification user messages (main): ${main.taskNotifications}; tags:`, Object.fromEntries(sorted(main.taskNotificationTags)))

  console.log('\n## 4. Workflow traces (main | subagent transcripts)')
  console.log('ticket commands in Bash tool_use:', top(main.ticketCommands), '|', top(sub.ticketCommands))
  console.log('Skill tool calls:', top(main.skillCalls, 8), '|', top(sub.skillCalls, 8))
  console.log('slash commands (<command-name>):', top(main.slashCommands, 8))
  console.log(`invoked_skills attachments: ${main.invokedSkills} | ${sub.invokedSkills}`)
  console.log('gate traces:', Object.fromEntries(sorted(main.gate)), '|', Object.fromEntries(sorted(sub.gate)))
  console.log(`records with gitBranch: ${main.withGitBranch}, with cwd: ${main.withCwd} of ${main.records} (main)`)

  console.log('\n## 5. Volumes')
  console.log(`full read of every transcript: ${(elapsed / 1000).toFixed(1)} s for ${mb(main.bytes + sub.bytes)}`)
  console.log(`${auctionPrefix}*: ${auction.main} main transcripts (${mb(auction.mainBytes)}), ${auction.sub} subagent transcripts (${mb(auction.subBytes)}); largest main there: ${mb(auction.largest)}`)
  console.log(`largest main transcript: ${mb(main.largest.bytes)} (${short(main.largest.path)})`)
  console.log(`largest subagent transcript: ${mb(sub.largest.bytes)} (${short(sub.largest.path)})`)
  if (main.largest.path === '') return undefined
  await timeReads(main.largest.path)
  return basename(main.largest.path, '.jsonl')
}

// ---------------------------------------------------------------------------------------------
// 5. Full read versus tail read

const TAIL_BYTES = 64 * 1024

const parseLines = (text: string): number => {
  let n = 0
  for (const line of text.split('\n')) {
    if (line.length === 0) continue
    try {
      JSON.parse(line)
      n += 1
    } catch {
      // the partial first line of a tail read
    }
  }
  return n
}

const timeReads = async (path: string): Promise<void> => {
  const t0 = performance.now()
  const full = parseLines(await readFile(path, 'utf8'))
  const t1 = performance.now()
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(TAIL_BYTES, size)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const text = buffer.toString('utf8')
    const tail = parseLines(text.slice(text.indexOf('\n') + 1))
    const t2 = performance.now()
    console.log(
      `largest main transcript: read+parse whole file ${(t1 - t0).toFixed(0)} ms (${full} records); ` +
        `last ${TAIL_BYTES / 1024} KB ${(t2 - t1).toFixed(1)} ms (${tail} records)`,
    )
  } finally {
    await handle.close()
  }
}

// ---------------------------------------------------------------------------------------------
// Skeleton mode: the structure of a transcript without its content.

// Keys whose string values are an enum, a tool name or a version: safe to print verbatim.
const KEEP_KEYS = new Set([
  'type',
  'subtype',
  'role',
  'version',
  'userType',
  'entrypoint',
  'permissionMode',
  'stop_reason',
  'operation',
  'level',
  'hookEvent',
  'origin',
  'promptSource',
  'turnOrigin',
  'requestShape',
  'status',
  'renderedRole',
  'effort',
  'perTurnEffort',
  'model',
  'name',
])

const skeleton = (v: Json, key: string): Json => {
  if (Array.isArray(v)) return v.map((x) => skeleton(x, key))
  if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, skeleton(x, k)]))
  if (typeof v !== 'string') return v
  if (KEEP_KEYS.has(key) && v.length <= 64 && !v.includes('/')) return v
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) return '<uuid>'
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return '<timestamp>'
  return `<str ${v.length}>`
}

const printSkeleton = async (path: string, max: number): Promise<void> => {
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  let n = 0
  for await (const line of lines) {
    if (line.length === 0) continue
    console.log(JSON.stringify(skeleton(JSON.parse(line) as Json, '')))
    n += 1
    if (n >= max) break
  }
}

// ---------------------------------------------------------------------------------------------
// Agent SDK readers: the SDK ships its own read-only parser of the same files.

const surveySdk = async (largestSessionId: string | undefined): Promise<void> => {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  console.log('\n## 5b. Agent SDK session readers (read-only)')
  let t = performance.now()
  const all = await sdk.listSessions()
  console.log(`listSessions(): ${all.length} sessions in ${(performance.now() - t).toFixed(0)} ms`)
  const withCustomTitle = all.filter((s) => s.customTitle !== undefined)
  console.log(
    `customTitle: ${withCustomTitle.length}, summary === customTitle: ${withCustomTitle.filter((s) => s.summary === s.customTitle).length}, ` +
      `firstPrompt: ${all.filter((s) => s.firstPrompt !== undefined).length}`,
  )
  // The folder name loses the difference between '/' and '-'; this only works for a prefix whose
  // path has no '-' or other non-alphanumerics, which is true for the default one.
  const auctionRoot = `/${auctionPrefix.slice(1).replaceAll('-', '/')}`
  t = performance.now()
  const project = await sdk.listSessions({ dir: auctionRoot })
  console.log(`listSessions({ dir: ${short(auctionRoot)} }) with worktrees: ${project.length} sessions in ${(performance.now() - t).toFixed(0)} ms`)
  if (largestSessionId !== undefined) {
    t = performance.now()
    const messages = await sdk.getSessionMessages(largestSessionId)
    console.log(`getSessionMessages(largest main transcript): ${messages.length} messages in ${(performance.now() - t).toFixed(0)} ms`)
  }
  t = performance.now()
  let agents = 0
  for (const s of project) agents += (await sdk.listSubagents(s.sessionId)).length
  console.log(`listSubagents() over those sessions: ${agents} agent ids in ${(performance.now() - t).toFixed(0)} ms`)
}

const run = async (): Promise<void> => {
  const skeletonPath = argValue('--skeleton')
  if (skeletonPath !== undefined) {
    await printSkeleton(skeletonPath, Number(argValue('--max') ?? '50'))
    return
  }
  console.log(`# Claude Code home survey: ${short(home)}`)
  await surveySessions()
  const largest = await surveyProjects()
  if (args.includes('--sdk')) await surveySdk(largest)
}

await run()
