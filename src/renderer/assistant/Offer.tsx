// The one offer to turn the Assistant on (worfy-assistant ticket 16; owner's decision 10; stories 29 and 30), after the
// prototype Card the owner accepted (its «Meet Assistant»): who the Assistant is, what it does and never does, that it
// uses the person's Claude Limits — never a price — and «Turn on and meet» or «Not now». worfy asks once: Not now ends
// the offer for good, and Settings → Assistant turns it on later.
//
// Two places show it while it stands (`offer.owed` of the view): the page after the welcome page of First run, for a new
// user (src/renderer/shell/FirstRun.tsx, with OfferDetails), and the top of the Assistant's section (OfferCard). The one
// message for an updated user is offer-notice.ts.
import { useId, type ReactElement } from 'react'
import './assistant.css'
import { Icon, Spark } from './icons'
import { answerOffer } from './useAssistant'

export const OFFER_TITLE = 'Meet Assistant'
export const OFFER_LEAD = 'worfy’s own agent, one per machine. It watches all your Projects, tells you what waits and why, and prepares the next step.'
export const OFFER_USES = 'It uses your Claude Limits. Its own share is always at the foot of its section, marked as an estimate.'
export const OFFER_FOOT = 'worfy asks once. Later: Settings → Assistant.'
export const OFFER_ACCEPT = 'Turn on and meet'
export const OFFER_DECLINE = 'Not now'

const DOES = ['Lists what waits for you, with the reason', 'Continues Sessions after the Limits reset', 'Checks Slack and Jira in your work hours', 'Answers questions about worfy']
const NEVER = ['Writes code or queues Epics', 'Posts outside worfy: only your Send does', 'Changes settings without your Apply', 'Starts a Session you haven’t read']

/** What it does and never does, and what it uses. */
export function OfferDetails(): ReactElement {
  return (
    <div className="w-asst-offer__details">
      <div className="w-asst-offer__can">
        <div>
          <h4>It does</h4>
          <ul>
            {DOES.map((line) => (
              <li key={line}>
                <span className="w-asst-offer__yes">
                  <Icon name="check" size={12} />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>It never</h4>
          <ul>
            {NEVER.map((line) => (
              <li key={line}>
                <span className="w-asst-offer__no">
                  <Icon name="x" size={12} />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="w-asst-offer__uses">
        <Icon name="gauge" />
        <span>{OFFER_USES}</span>
      </div>
    </div>
  )
}

/** The offer at the top of the Assistant's section; the list of what waits stays under it. */
export function OfferCard(): ReactElement {
  const titleId = useId()
  return (
    <section className="w-asst-offer" aria-labelledby={titleId} data-testid="assistant-offer">
      <span className="w-asst-avatar w-asst-offer__avatar">
        <Spark size={18} />
      </span>
      <h3 id={titleId}>{OFFER_TITLE}</h3>
      <p className="w-asst-offer__lead">{OFFER_LEAD}</p>
      <OfferDetails />
      <div className="w-asst-offer__row">
        <button type="button" className="w-asst-button w-asst-button--assistant" onClick={() => void answerOffer('accepted')}>
          <Spark size={12} />
          {OFFER_ACCEPT}
        </button>
        <button type="button" className="w-asst-button w-asst-button--ghost" onClick={() => void answerOffer('declined')}>
          {OFFER_DECLINE}
        </button>
      </div>
      <div className="w-asst-offer__foot">{OFFER_FOOT}</div>
    </section>
  )
}
