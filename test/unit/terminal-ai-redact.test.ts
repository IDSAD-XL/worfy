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
const STRIPE = `sk_live_${'4eC39HqLyjWDarjtT1zdp7dc'}`
const STRIPE_RESTRICTED = `rk_live_${'51HxYzAbCdEf0123456789'}`
const GOOGLE = `AIza${'SyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY'}`
const ANTHROPIC_REAL = `sk-ant-api03-${'Zq7_aB3-xY9k'.repeat(8).slice(0, 95)}`
const OPENAI_PROJECT = `sk-proj-${'Ab3dEf6hIj9kLm2n'.repeat(4)}`
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
    ['a curl -u password', 'curl -u admin:hunter2 https://x.dev', `curl -u admin:${REDACTED} https://x.dev`],
    ['a curl --user= password in quotes', `curl --user='admin:hunter2' https://x.dev`, `curl --user='admin:${REDACTED}' https://x.dev`],
    ['a mysql -p password', 'mysql -u root -pSecret db', `mysql -u root -p${REDACTED} db`],
    ['a mysqldump -p password', 'mysqldump -h db.local -ps3cr3t app > dump.sql', `mysqldump -h db.local -p${REDACTED} app > dump.sql`],
    ['an Authorization: Basic header', 'curl -H "Authorization: Basic dXNlcjpwYXNzd29yZA==" https://x.dev', `curl -H "Authorization: Basic ${REDACTED}" https://x.dev`],
    ['an Authorization: token header', 'curl -H "Authorization: token abc123def456" https://api.github.com', `curl -H "Authorization: token ${REDACTED}" https://api.github.com`],
    ['an npm _authToken', 'npm config set //registry.npmjs.org/:_authToken=npm_abcdef123456', `npm config set //registry.npmjs.org/:_authToken=${REDACTED}`],
    ['an APIKEY variable', 'APIKEY=abc123 ./deploy.sh', `APIKEY=${REDACTED} ./deploy.sh`],
    ['a Stripe secret key', `stripe charges list --api ${STRIPE}`, `stripe charges list --api ${REDACTED}`],
    ['a Stripe restricted key', `export K=${STRIPE_RESTRICTED}`, `export K=${REDACTED}`],
    ['an Anthropic key file after a slash', `cat ~/keys/${ANTHROPIC_REAL}`, `cat ~/keys/${REDACTED}`],
    ['an OpenAI key in a URL path', `curl https://x.io/v1/${OPENAI_PROJECT}/run`, `curl https://x.io/v1/${REDACTED}/run`],
    ['an Anthropic key after a dot', `echo foo.${ANTHROPIC_REAL}`, `echo foo.${REDACTED}`],
    ['a wget --user= password', 'wget --user=admin:hunter2 https://x.dev/f', `wget --user=admin:${REDACTED} https://x.dev/f`],
    ['an httpie -a password', 'http -a admin:hunter2 api.local/me', `http -a admin:${REDACTED} api.local/me`],
    ['a curl -u password after other options', 'curl -s -H "Accept: x" -u admin:hunter2 https://x.dev', `curl -s -H "Accept: x" -u admin:${REDACTED} https://x.dev`],
    ['a Google API key', `curl "https://maps.googleapis.com/x?key=${GOOGLE}"`, `curl "https://maps.googleapis.com/x?key=${REDACTED}"`],
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

  it('replaces a bare Basic credential, base64 with a digit or padding, or base64 of user:password', () => {
    expect(redactSecrets('Basic dXNlcjpwYXNzd29yZA==')).toBe(`Basic ${REDACTED}`)
    expect(redactSecrets(`header Basic ${btoa('abc:defgh')} sent`)).toBe(`header Basic ${REDACTED} sent`)
    expect(btoa('abc:defgh')).toMatch(/^[A-Za-z]+$/) // the decoding branch decides, not a digit or padding
  })

  it('replaces a private key block of command output', () => {
    const output = ['cat id_ed25519', '-----BEGIN OPENSSH PRIVATE KEY-----', 'b3BlbnNzaC1rZXktdjEAAAAA', '-----END OPENSSH PRIVATE KEY-----', 'done'].join('\n')
    expect(redactSecrets(output)).toBe(['cat id_ed25519', REDACTED, 'done'].join('\n'))
  })

  it.each([
    'git status',
    'export PATH=/usr/bin',
    'ls -la',
    'git log --oneline -n 5',
    'npm run task-runner',
    'KEYBOARD=us setxkbmap',
    'curl https://example.com/path?q=1',
    'ssh git@github.com',
    'echo $GITHUB_TOKEN',
    'git checkout feature/sk-learn-upgrade-for-models',
    'pip install sk-learn-upgrade-for-models',
    'git push -u origin main',
    'mkdir -p build/out',
    'mysql -p',
    'sort -u names.txt',
    'MONKEY=1 make',
    'docker run -u 1000:1000 img',
    'docker exec --user root:root c sh',
    'podman run --user=nobody:nogroup img',
    'sort -u a:b',
    'docker run -e URL=https://x.io -u 1000:1000 img',
    'docker run --name my-curl -u 1000:1000 img',
    'echo "Basic configuration done"',
    'Basic authentication failed',
    '## Basic Requirements',
  ])(
    'leaves %s as it is',
    (command) => {
      expect(redactSecrets(command)).toBe(command)
    },
  )
})
