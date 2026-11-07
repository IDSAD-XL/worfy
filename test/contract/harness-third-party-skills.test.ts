// Matt Pocock's skills, version 1.3.1, live inside the worfy plugin as a frozen copy (epic
// worfy-skills, ticket 01). The copy is byte for byte the upstream one except the cross-references
// that harness/skills/THIRD_PARTY.md lists: a skill calls another skill by its worfy: name, and tracker
// setup points to /worfy:connect-project and bin/TICKETS.md instead of /setup-matt-pocock-skills.
// The hashes below are of the files of the installed 1.3.1 copy (upstream commit 49dd158d); the copy
// itself is not in this repository, so the test pins them.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = join(__dirname, '..', '..')
const HARNESS = join(REPO, 'harness')
const SKILLS = join(HARNESS, 'skills')

// sha256 of every file of the 19 copied skills in mattpocock-skills 1.3.1, by `<skill>/<file>`.
const UPSTREAM: Record<string, string> = {
  'code-review/SKILL.md': '09eb147f793e4647949edd32dbad278f0554dfb56e0d46b699cd4c2c55bf0357',
  'code-review/agents/openai.yaml': '8229ca854e11dc8e6aef2131ee03f31fb1561cf905fab9ccc325180cf3331352',
  'codebase-design/DEEPENING.md': 'f3dd099ce99289bd213914d8ee3e2429b78309c3957ca4583f7659551b1d53c1',
  'codebase-design/DESIGN-IT-TWICE.md': '52b52e75655a27aea59c6966b410bac82448968ad46ef1ebb9f07c274e3ae010',
  'codebase-design/SKILL.md': '2c20617f87ec8af6a434859f381b2f061a69b530444e74eb39e78bb016a6d1e2',
  'codebase-design/agents/openai.yaml': 'edebc9e4fcfe102114012575eaa9600b9b5fd08c311664f389c36e7bc717740f',
  'diagnosing-bugs/SKILL.md': '849198df88cdb65fd0d97236604c1fca7ff2f22d2f705f9724a800d0266b118d',
  'diagnosing-bugs/agents/openai.yaml': '3e430dbe4334a87597488c060cb3dc3786bb00c9182877d6f5ec41f62490e90b',
  'diagnosing-bugs/scripts/hitl-loop.template.sh': '35103539fc36873eea36074769ad454f9379d6fc8b2dc0e26ce987fd3bfe5503',
  'domain-modeling/ADR-FORMAT.md': '944c92aa790e8fbdc9199640b170979abb8a34ba8d0fe18c2a01a63bce140ca0',
  'domain-modeling/GLOSSARY-FORMAT.md': '21dcc40cdec8e151a829b98ab1517c1867bc444e3665134a98c6983411996801',
  'domain-modeling/SKILL.md': '7b925d7b1e341a2eeae33ad68a8a8c0ab889a38ddd22a7598e4c240e5a7556a3',
  'domain-modeling/agents/openai.yaml': 'f6bf2aa996c6e6f53fdd0708e18a0d16a56aed8322cca59fedbe3c0d2c75f06b',
  'grill-with-docs/SKILL.md': '7de372c13488f1ee96cc11cd8907b56b6809cc93eef776eeddd37de6b6cbe3fe',
  'grill-with-docs/agents/openai.yaml': '94cd0ab161fb468a836349f5ed482ba58ce8e709a05c57ce533d739dbd35cca9',
  'improve-codebase-architecture/HTML-REPORT.md': '581e8bb5a521e46bbda8ca7e19b15948bed882187108092ebb90c62513b77528',
  'improve-codebase-architecture/SKILL.md': '552240a5ab5cec6b67c15dd1ad6e9f6962b1bca6ce870059a8c2713760c20392',
  'improve-codebase-architecture/agents/openai.yaml': 'c8cb20f68ebf0edb4e497bc11ae5fcaa196004e661cd189015b04f4109ced7f1',
  'prototype/LOGIC.md': 'f61c7d249e786a79ef289018901c348271e1798dd0b0bc5607b5c6f4d4a01ab9',
  'prototype/SKILL.md': '714de632d116bb73f65cdb5a882db15b9369a6713b9a47c0fad827848f0bfbe3',
  'prototype/UI.md': '723211e878acbc7b6ff09755263f3295cde724ba902ff0064da41eed51d45ad3',
  'prototype/agents/openai.yaml': '5af65e43ab41a350436697b81e27b7f848d36782043b73c322bb2c9fa9cc55dc',
  'research/SKILL.md': '985569f15739c713d6784887c3d186d4ef9ac85bec5ad9c068d25bf0739928e4',
  'research/agents/openai.yaml': '9b4c470d63221c1f68f22df70b83e2f12401b317babe0d1b7b5f24a974474d0d',
  'tdd/SKILL.md': '5505d25bbaa8fc14a79e4d20163936958992a2995b7f1dd1d6197edc9ed722e0',
  'tdd/agents/openai.yaml': 'ea6f01cf1b8c06a4b0f5b649d74b1b8ce8685e72af1b38d70d877693e092af0b',
  'tdd/mocking.md': '3ceb807fdf4a47d6a93d4d9a891e5ba6d362a6247bd08adc451feebfc17361ef',
  'tdd/tests.md': '859f9e592c188fda4fc7277dd180e4ce9c7a2e13f6efe1f6f29eccc9d28c106a',
  'to-spec/SKILL.md': '43ad9cf318e5e7d3d1fa360253a37021796dc87a0c2e595ad262661a10f85088',
  'to-spec/agents/openai.yaml': '1c5b4d1e3d8e52287ef19cc2742fdbbfae1914ac75d33af3e4c8174f08cc55bb',
  'to-tickets/SKILL.md': '56ec23c5b2782785d4e65bff9e315b6d3aeb4ef977c174a219e99489fada1995',
  'to-tickets/agents/openai.yaml': '21bc6215fffcd7614e9f772bb1760e87cc5fc7dcc707e7d282bc9414267a6090',
  'wayfinder/SKILL.md': '9be7b478c389605a24517d27752f278933588da97a1b5921b165f455edf4c5b7',
  'wayfinder/agents/openai.yaml': '88bc81a11a6d52ac67aeaa76b8b619e387020d47c5133a4dd4927fd15c4ad073',
  'grill-me/SKILL.md': 'caaf8b8de1684f96e26b28f3c29189db5c89cce4b73e1c93d86164f66ef88637',
  'grill-me/agents/openai.yaml': 'c061e39c3e0f9d865fb1b97556d485704af2a8a58f4b8221a8917a5c2074a32b',
  'grilling/SKILL.md': 'befdff1e27a1dfe2a294d5871169ac1afe16d983911daa4f32627514a48c1e15',
  'grilling/agents/openai.yaml': '1411d7df7d99b7e621a1ff8283c8133cc2464be63d064e52d8ce169c6800ee9b',
  'handoff/SKILL.md': '4cbb043950dad2ffd3662ff1a5a0b51ae676004b5cae10e3787e8ee7a4ee69d3',
  'handoff/agents/openai.yaml': '5c479fd562c691851690e8b18c8501045bef0943c10743d636b2fae26add1d28',
  'teach/GLOSSARY-FORMAT.md': '9b99859ec28437668130d8f2ce5a342938970f8a1ed4fd38c3eab4f4b5fff210',
  'teach/LEARNING-RECORD-FORMAT.md': '701fa34b6748aa89e6c960ffb815257f481a7d77fb2900f9028f7edf3fdd6052',
  'teach/MISSION-FORMAT.md': '8cacbb3c0644d3ae0ea4965564797099401a6930a23f7cf462918576587f2418',
  'teach/RESOURCES-FORMAT.md': 'e9cacf34026e11a8d1c8f9de88abe5bcbf654f4ebdb25cae8c0de0d5f48f44ec',
  'teach/SKILL.md': '550482c2d674b085c9043b87bfdc14a8f2ec453c736119e7fcbb1e9332bffeba',
  'teach/agents/openai.yaml': '5856f3ae8aec742f1499c640aecdd5f1d6af5fa210a7c6ec794de8263a6f733f',
  'to-questionnaire/SKILL.md': 'b5eb929842ee0e93d867c5e906d183d350f2f2d149eaeaa86967d94d8eda1d3b',
  'to-questionnaire/agents/openai.yaml': '9e8a06c38c8842eea8d4922cb9d1ead8e3ace647bab259b943c994a1b4742bc2',
  'wait-what/SKILL.md': 'd961bb37defd975c539427edb8f450cdbccdcdd552e213c1ece46676a7970905',
  'wait-what/agents/openai.yaml': 'b41faadf741d51e4ea184148b2d1854d93f947aaf754c7844f70a00f04194999',
  'writing-for-agents/SKILL-MECHANICS.md': 'c768e6307c7c10728c401c213f2c4ba71c542127eeb7ad2956aabd15a0fa0059',
  'writing-for-agents/SKILL.md': '551adca942227b44192edba88acd4e8db911f0121ce58ad16944ccf6a896a74a',
  'writing-for-agents/agents/openai.yaml': 'eacb24b2a618cfb81dacb0416f4fdd75ddf3a8060f8ddb99aae1b1e301907e4b',
}

// sha256 of LICENSE at the root of the 1.3.1 copy.
const UPSTREAM_LICENSE = '0e7ac423bf2c6e223b7c5b156f8cf72da49d748e56a1641402c31f22ad07dbb5'

// `disable-model-invocation` of each copied skill in 1.3.1: true = only the user starts it.
const MANUAL_ONLY: Record<string, boolean> = {
  'code-review': false,
  'codebase-design': false,
  'diagnosing-bugs': false,
  'domain-modeling': false,
  'grill-with-docs': true,
  'improve-codebase-architecture': true,
  prototype: false,
  research: false,
  tdd: false,
  'to-spec': true,
  'to-tickets': true,
  wayfinder: true,
  'grill-me': true,
  grilling: false,
  handoff: true,
  teach: true,
  'to-questionnaire': true,
  'wait-what': true,
  'writing-for-agents': false,
}
const COPIED = Object.keys(MANUAL_ONLY)

// The skills of 1.3.1 that worfy did not take (THIRD_PARTY.md, "Not copied"): a reference to one of
// them by its bare name is as wrong as one to a copied skill.
const NOT_TAKEN = [
  'ask-matt',
  'setup-matt-pocock-skills',
  'pr',
  'wizard',
  'triage',
  'implement',
  'implement-spec',
  'retro',
  'git-guardrails-claude-code',
  'migrate-to-shoehorn',
  'scaffold-exercises',
  'setup-pre-commit',
  'chief-of-staff',
  'claude-handoff',
  'loop-me',
  'setup-ts-deep-modules',
  'writing-beats',
  'writing-fragments',
  'writing-shape',
]

// Files of harness/ that may still name the upstream plugin. THIRD_PARTY.md names it on purpose.
// plugin.json declares the dependency until ticket 03 drops it, and README.md describes that
// dependency until ticket 04 rewrites it; each of those tickets removes its line here.
const MAY_NAME_UPSTREAM = new Set(['skills/THIRD_PARTY.md', '.claude-plugin/plugin.json', 'README.md'])

const listFiles = (dir: string, base: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? listFiles(path, base) : [relative(base, path).split(sep).join('/')]
  })

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

const skillDirs = (): string[] =>
  readdirSync(SKILLS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

const frontmatter = (text: string): Record<string, string> => {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ''
  return Object.fromEntries(
    block
      .split('\n')
      .map((line) => /^([a-z-]+):\s*(.*)$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => [match[1], match[2]]),
  )
}

// `skills/<skill>/<file>` paths in backticks of the section "## Reference edits" of THIRD_PARTY.md.
const editedFiles = (): string[] => {
  const text = readFileSync(join(SKILLS, 'THIRD_PARTY.md'), 'utf8')
  const section = text.split(/^## Reference edits$/m)[1]?.split(/^## /m)[0] ?? ''
  return [...new Set([...section.matchAll(/`skills\/([a-z-]+\/[A-Za-z0-9._/-]+)`/g)].map((match) => match[1] ?? ''))]
}

const markdownOfSkills = (): { file: string; lines: string[] }[] =>
  listFiles(SKILLS, SKILLS)
    .filter((file) => file.endsWith('.md'))
    .map((file) => ({ file, lines: readFileSync(join(SKILLS, file), 'utf8').split('\n') }))

describe('the copy of mattpocock-skills 1.3.1 in harness/skills', () => {
  it.each(COPIED)('has %s with the files of 1.3.1', (skill) => {
    const dir = join(SKILLS, skill)
    expect(existsSync(dir)).toBe(true)
    const expected = Object.keys(UPSTREAM)
      .filter((file) => file.startsWith(`${skill}/`))
      .sort()
    expect(
      listFiles(dir, SKILLS)
        .filter((file) => file.startsWith(`${skill}/`))
        .sort(),
    ).toEqual(expected)
  })

  it('keeps every file byte for byte, except the reference edits THIRD_PARTY.md lists', () => {
    const edited = new Set(editedFiles())
    const changed = Object.entries(UPSTREAM)
      .filter(([file]) => !edited.has(file))
      .filter(([file, hash]) => existsSync(join(SKILLS, file)) && sha256(join(SKILLS, file)) !== hash)
      .map(([file]) => file)
    expect(changed).toEqual([])
  })

  it('lists in THIRD_PARTY.md only files of the copy that really differ from 1.3.1', () => {
    const edited = editedFiles()
    expect(edited.length).toBeGreaterThan(0)
    for (const file of edited) {
      expect(UPSTREAM, file).toHaveProperty([file])
      expect(sha256(join(SKILLS, file)), file).not.toBe(UPSTREAM[file])
    }
  })

  it.each(COPIED)('keeps the frontmatter of %s: name is the folder, disable-model-invocation as in 1.3.1', (skill) => {
    const meta = frontmatter(readFileSync(join(SKILLS, skill, 'SKILL.md'), 'utf8'))
    expect(meta.name).toBe(skill)
    expect(meta['disable-model-invocation'] === 'true').toBe(MANUAL_ONLY[skill])
  })

  it('ships the MIT LICENSE of 1.3.1 unchanged and the attribution file', () => {
    expect(sha256(join(SKILLS, 'LICENSE.mattpocock-skills'))).toBe(UPSTREAM_LICENSE)
    const attribution = readFileSync(join(SKILLS, 'THIRD_PARTY.md'), 'utf8')
    for (const fact of ['github.com/mattpocock/skills', '1.3.1', '49dd158d1076134a641b33efb035946536778336', 'MIT', 'Matt Pocock']) {
      expect(attribution).toContain(fact)
    }
    for (const skill of COPIED) expect(attribution).toContain(`\`${skill}\``)
  })
})

describe('references between skills in harness/skills', () => {
  const known = new Set([...skillDirs(), ...COPIED, ...NOT_TAKEN])

  it('calls the Skill tool only with worfy:<skill> of a skill the plugin has', () => {
    const dirs = new Set(skillDirs())
    const wrong = markdownOfSkills().flatMap(({ file, lines }) =>
      lines.flatMap((line, i) =>
        line.includes('Skill tool')
          ? [...line.matchAll(/"([a-z][a-z0-9:-]*)"/g)]
              .map((match) => match[1] ?? '')
              .filter((name) => !(name.startsWith('worfy:') && dirs.has(name.slice('worfy:'.length))))
              .map((name) => `${file}:${i + 1} "${name}"`)
          : [],
      ),
    )
    expect(wrong).toEqual([])
  })

  it('names a skill as a slash command only with the worfy: prefix', () => {
    const wrong = markdownOfSkills().flatMap(({ file, lines }) =>
      lines.flatMap((line, i) =>
        [...line.matchAll(/`\/([a-z][a-z0-9-]*)`|`([a-z][a-z0-9-]*)` skill/g)]
          .map((match) => match[1] ?? match[2] ?? '')
          .filter((name) => known.has(name))
          .map((name) => `${file}:${i + 1} ${name}`),
      ),
    )
    expect(wrong).toEqual([])
  })

  // The name of the licence file is the one exception: it says whose licence it is.
  it('leaves no mattpocock-skills, setup-matt-pocock-skills or ask-matt in harness/', () => {
    const found = listFiles(HARNESS, HARNESS)
      .filter((file) => !MAY_NAME_UPSTREAM.has(file))
      .filter((file) =>
        /mattpocock-skills|setup-matt-pocock-skills|ask-matt/.test(
          readFileSync(join(HARNESS, file), 'utf8').replaceAll('LICENSE.mattpocock-skills', ''),
        ),
      )
    expect(found).toEqual([])
  })
})
