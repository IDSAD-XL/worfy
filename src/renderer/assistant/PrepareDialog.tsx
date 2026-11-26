// Prepare (worfy-assistant ticket 14; stories 21 and 22; ADR-0114, boundary 3): the exact text of the Session the Assistant
// — or worfy, for the fix of a red main branch — would start, shown before anything starts. The user may edit it; the
// Session starts only on Start, with exactly the text in the window.
import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { Button } from '../theme/Button'
import { Dialog } from '../theme/kit/Dialog'
import { Icon, Spark } from './icons'
import { startPrepared, useAssistant, type PrepareRequest } from './useAssistant'

export function PrepareDialog(): ReactElement | null {
  const request = useAssistant((state) => state.prepare)
  // A new request is a new window: its text, not the edit of the one before.
  const [opened, setOpened] = useState(0)
  const [shown, setShown] = useState(request)
  if (shown !== request) {
    setShown(request)
    setOpened(opened + 1)
  }
  return request === null ? null : <PrepareWindow key={opened} request={request} />
}

function PrepareWindow({ request }: { request: PrepareRequest }): ReactElement {
  const [text, setText] = useState(request.text)
  const [editing, setEditing] = useState(false)
  const [starting, setStarting] = useState(false)
  const titleId = useId()
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (editing) box.current?.focus()
  }, [editing])
  const close = () => useAssistant.setState({ prepare: null })
  const start = () => {
    if (text.trim() === '' || starting) return
    setStarting(true)
    void startPrepared(request, text).then((started) => (started ? close() : setStarting(false)))
  }
  return (
    <Dialog open onClose={close} labelledBy={titleId} className="w-asst-prepare" backdropTestId="assistant-prepare-backdrop" data-testid="assistant-prepare">
      <div className="w-asst-prepare__head">
        <span className="w-asst-avatar">
          <Spark />
        </span>
        <div className="w-asst-prepare__title">
          <h3 id={titleId}>Prepare a Session</h3>
          <p>
            {request.by === 'assistant' ? 'Assistant' : 'worfy'} wrote this from “{request.title}”. Read it before you start.
          </p>
        </div>
      </div>
      <div className="w-asst-prepare__facts">
        <span>Project</span>
        <span>Where</span>
        <span>Agent</span>
        <b className="w-mono">{request.projectName ?? request.projectId}</b>
        <b>New Session on the Canvas</b>
        <b>Claude Code</b>
      </div>
      <div className="w-asst-prepare__exact-head">
        <Icon name="doc" size={12} />
        The exact text the Session starts with
        <span className="w-asst-prepare__gap" />
        {editing ? null : (
          <button type="button" className="w-asst-button w-asst-button--ghost" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
      <div className="w-asst-prepare__exact">
        {editing ? (
          <textarea ref={box} aria-label="The exact text of the Session" value={text} onChange={(event) => setText(event.target.value)} />
        ) : (
          <pre data-testid="assistant-prepare-text">{text}</pre>
        )}
        <div className="w-asst-prepare__tag">
          <Icon name="lock" size={12} />
          Text from outside is quoted as data, with its source and author.
        </div>
      </div>
      <div className="w-asst-prepare__foot">
        <span className="w-asst-prepare__hint">
          Nothing starts until you press Start.
          <br />
          The Session gets exactly this text.
        </span>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" icon={<Icon name="term" />} disabled={text.trim() === '' || starting} onClick={start}>
          Start Session
        </Button>
      </div>
    </Dialog>
  )
}
