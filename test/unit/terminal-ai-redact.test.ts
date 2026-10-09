// Redaction of the Terminal AI context (src/shared/terminal-ai/redact.ts): the usual forms of a
// secret in a command line or in command output become [redacted], ordinary commands stay as they are.
// The sample secrets are made up and assembled from parts, so no scanner takes this file for a leak.
import { describe, expect, it } from 'vitest'
import { REDACTED, redactSecrets } from '../../src/shared/terminal-ai/redact'

const repeat = (text: string, times: number): string => text.repeat(times)

const AWS = `AKIA${'IOSFODNN7EXAMPLE'}`
const GITHUB_CLASSIC = `ghp_${repeat('a1B2', 9)}`
const GITHUB_FINE = `github_pat_${repeat('11ABCD', 4)}_${repeat('xY9', 10)}`
const ANTHROPIC = `sk-ant-api03-${repeat('Zq7_', 10)}`
const SLACK = `xoxb-${'1234567890'}-${'abcdefghij'}`
const JWT = `eyJ${'hbGciOiJIUzI1NiJ9'}.eyJ${'zdWIiOiIxIn0'}.${'sflKxwRJSMeKKF2QT4fwpMeJf36P'}`

describe('redactSecrets', () => {
  it.each([
    ['an AWS access key id', `aws configure set aws_access_key_id ${AWS}`, `aws configure set aws_access_key_id ${REDACTED}`],
    ['a classic GitHub token', `gh auth login --with-token ${GITHUB_CLASSIC}`, `gh auth login --with-token ${REDACTED}`],
    ['a fine-grained GitHub token', `git clone https://${GITHUB_FINE}@github.com/o/r.git`, `git clone https://${REDACTED}@github.com/o/r.git`],
    ['an Anthropic key', `curl -H "x-api-key: ${ANTHROPIC}" https://api.anthropic.com`, `curl -H "x-api-key: ${REDACTED}" https://api.anthropic.com`],
    ['a Slack token', `slack-cli --auth ${SLACK} post`, `slack-cli --auth ${REDACTED} post`],
    ['a JWT', `http GET api.local/me cookie:session=${JWT}`, `http GET api.local/me cookie:session=${REDACTED}`],
    ['a Bearer credential', 'curl -H "Authorization: Bearer abc.DEF-123_xyz" https://x.dev', `curl -H "Authorization: Bearer ${REDACTED}" https://x.dev`],
    ['a *_TOKEN variable', 'GITHUB_TOKEN=plainvalue123 gh pr list', `GITHUB_TOKEN=${REDACTED} gh pr list`],
    ['an exported *_KEY variable', 'export OPENAI_API_KEY="some value"', `export OPENAI_API_KEY=${REDACTED}`],
    ['a *SECRET* variable', "CLIENT_SECRET_VALUE='s3cr3t' ./run.sh", `CLIENT_SECRET_VALUE=${REDACTED} ./run.sh`],
    ['a PASSWORD variable', 'PASSWORD=hunter2 mysql -u root', `PASSWORD=${REDACTED} mysql -u root`],
    ['a lower-case password in a query string', 'curl "https://x.dev/login?user=me&password=hunter2&x=1"', `curl "https://x.dev/login?user=me&password=${REDACTED}&x=1"`],
    ['a password in a URL', 'psql postgres://admin:hunter2@db.local:5432/app', `psql postgres://admin:${REDACTED}@db.local:5432/app`],
    ['a --password option', 'mysql --password hunter2 -u root', `mysql --password ${REDACTED} -u root`],
    ['a --token= option', 'vault login --token=s.abcdef', `vault login --token=${REDACTED}`],
  ])('replaces %s', (_name, input, expected) => {
    expect(redactSecrets(input)).toBe(expected)
  })

  it('replaces a secret in the middle of a long line, every occurrence', () => {
    const line = `${'echo start; '.repeat(20)}deploy --key ${GITHUB_CLASSIC} --other ${AWS} && ${'ls -la; '.repeat(20)}`
    const redacted = redactSecrets(line)
    expect(redacted).not.toContain(GITHUB_CLASSIC)
    expect(redacted).not.toContain(AWS)
    expect(redacted).toBe(`${'echo start; '.repeat(20)}deploy --key ${REDACTED} --other ${REDACTED} && ${'ls -la; '.repeat(20)}`)
  })

  it('replaces a private key block of command output', () => {
    const output = ['cat id_ed25519', '-----BEGIN OPENSSH PRIVATE KEY-----', 'b3BlbnNzaC1rZXktdjEAAAAA', '-----END OPENSSH PRIVATE KEY-----', 'done'].join('\n')
    expect(redactSecrets(output)).toBe(['cat id_ed25519', REDACTED, 'done'].join('\n'))
  })

  it.each(['git status', 'export PATH=/usr/bin', 'ls -la', 'git log --oneline -n 5', 'npm run task-runner', 'KEYBOARD=us setxkbmap', 'curl https://example.com/path?q=1', 'ssh git@github.com', 'echo $GITHUB_TOKEN'])(
    'leaves %s as it is',
    (command) => {
      expect(redactSecrets(command)).toBe(command)
    },
  )
})
