// The qmd stand-in of ./qmd as a Node script, for Windows (see ./node.mjs; the variables are those of ./qmd).
import { appendFileSync } from 'node:fs'
import process from 'node:process'

const args = process.argv.slice(2)
const env = process.env
if (args[0] === '--version') {
  process.stdout.write(`qmd ${env.QMD_STUB_VERSION} (abc1234)\n`)
} else {
  appendFileSync(env.CALLS, `qmd ${args.join(' ')} emb=${env.QMD_EMBED_MODEL} gen=${env.QMD_GENERATE_MODEL ?? 'unset'} mark=${env.LOGIN_MARK}\n`)
  const code = Number(env.QMD_STUB_PULL_CODE ?? 0)
  if (code !== 0) {
    process.stderr.write('first\npull: network down\n')
    process.exitCode = code
  } else if (args[0] === 'pull') {
    process.stdout.write('\u001b[1mPulling models\u001b[0m\n')
    process.stdout.write(`- ${env.QMD_EMBED_MODEL} -> /cache/a.gguf (610 MB, cached/checked)\n`)
    process.stdout.write(`- ${env.PULLED_GENERATE ?? env.QMD_GENERATE_MODEL ?? env.QMD_STUB_GENERATE_DEFAULT} -> /cache/b.gguf (1 GB, refreshed)\n`)
    process.stdout.write(`- ${env.QMD_STUB_RERANK} -> /cache/c.gguf (610 MB, cached/checked)\n`)
  }
}
