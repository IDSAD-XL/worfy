// The jq stand-in of ./jq as a Node script, for Windows (README.md): only `jq --version`.
import process from 'node:process'
import { log, unsupported } from './stand-in.mjs'

const args = process.argv.slice(2)
log('jq', args)
if (args[0] === '--version') process.stdout.write('jq-1.7.1\n')
else unsupported('jq', args)
