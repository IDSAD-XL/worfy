// The data flow of a Terminal (worfy-guide ticket 13), the diagram of the Topic's Under the hood, from
// the "Data flow" paragraphs and "How it works" of docs/features/terminal.md. The Node opens its shell
// through TerminalRegistry in main; each chunk of output goes to the Node, the kept output and the
// headless screen, which answers a program's questions once. A zsh asks Terminal AI over its socket
// (ShellLink), and AssistService asks Claude Code; Fix starts from the Node over IPC. Labelled from the
// texts' `underTheHood.flow.labels`.
import type { SceneProps } from '../../content'
import { LivingScene } from '../../scene/LivingScene'
import { TERMINAL_FLOW } from './spec'

export default function Flow(props: SceneProps) {
  return <LivingScene spec={TERMINAL_FLOW} {...props} />
}
