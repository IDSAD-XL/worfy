// The window of the worfy Guide (worfy-guide ticket 03, ADR-0090): a modal dialog over the app
// window, drawn in the layer of the Settings window. The list of Topics on the left, the Topic on the
// right: its diagram, a short text, Under the hood folded below — a data-flow diagram when the Topic
// has one (Flow.tsx), more text, the main files, the limits — and Full page. The header has the EN / RU switch, the one place of worfy that is not
// English only; the choice goes to the app settings of this Machine.
//
// This module and what it imports below (content.ts, the texts, the diagrams, guide.css) are the
// Guide's own chunk: GuideHost.tsx loads it with React.lazy the first time the Guide opens, so the
// start of the app does not load it. Nothing in it needs a Project or the network; the GitHub
// links open in the system's browser (`shell.openExternal`).
import { useId, useLayoutEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { GUIDE_LANGUAGES, type GuideLanguage } from '../../shared/settings/app-settings'
import '../canvas/actions/actions.css'
import { SETTINGS_LAYER } from '../settings/settings-window'
import { setAppSettings, useAppSettings } from '../settings/useAppSettings'
import { GUIDE_CONTENT, GUIDE_STRINGS, type GuideStrings, type GuideTopic } from './content'
import { guideLanguage } from './language'
import { githubFileUrl, openInBrowser } from './links'
import { shownTopics } from './registry'
import { closeGuide, selectGuideTopic, setGuideDialogElement, useGuide } from './store'
import './guide.css'

/** Opens `url` in the system's browser instead of in the window. */
function openExternal(event: MouseEvent<HTMLAnchorElement>, url: string): void {
  event.preventDefault()
  openInBrowser(url)
}

function ExternalLink({ url, title, className, children }: { url: string; title: string; className?: string; children: ReactNode }) {
  return (
    <a href={url} title={title} className={className} onClick={(event) => openExternal(event, url)}>
      {children}
    </a>
  )
}

function TopicView({ topic, language, strings, version }: { topic: GuideTopic; language: GuideLanguage; strings: GuideStrings; version: string | null }) {
  const text = topic.text[language]
  const descriptionId = useId()
  const flowDescriptionId = useId()
  const Scene = topic.Scene
  const Flow = topic.Flow
  const flow = text.underTheHood.flow
  const page = topic.meta.sources[0]?.page
  return (
    <article className="w-guide__topic" lang={language} data-testid="guide-topic" data-topic={topic.id}>
      <h3 className="w-guide__topic-title">{text.title}</h3>
      {Scene === null ? null : (
        <figure className="w-guide__figure" role="group" aria-label={text.title} aria-describedby={descriptionId}>
          <Scene labels={text.scene.labels} strings={strings} />
          <figcaption id={descriptionId} className="w-guide__sr-only">
            {text.scene.description}
          </figcaption>
        </figure>
      )}
      {text.summary.map((paragraph, index) => (
        <p key={index} className="w-guide__text">
          {paragraph}
        </p>
      ))}
      <details className="w-guide__under" data-testid="guide-under-the-hood">
        <summary className="w-guide__under-summary">{strings.underTheHood}</summary>
        {Flow === null || flow === undefined ? null : (
          <figure className="w-guide__figure w-guide__figure--flow" role="group" aria-label={strings.dataFlow} aria-describedby={flowDescriptionId}>
            <Flow labels={flow.labels} strings={strings} />
            <figcaption id={flowDescriptionId} className="w-guide__sr-only">
              {flow.description}
            </figcaption>
          </figure>
        )}
        {text.underTheHood.text.map((paragraph, index) => (
          <p key={index} className="w-guide__text">
            {paragraph}
          </p>
        ))}
        {topic.meta.files.length === 0 ? null : (
          <table className="w-guide__files">
            <caption className="w-guide__heading">{strings.files}</caption>
            <tbody>
              {topic.meta.files.map((path) => (
                <tr key={path}>
                  <td className="w-guide__file">
                    <ExternalLink url={githubFileUrl(path, version)} title={strings.openOnGitHub}>
                      {path}
                    </ExternalLink>
                  </td>
                  <td>{text.underTheHood.files[path]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {text.underTheHood.limits.length === 0 ? null : (
          <>
            <h4 className="w-guide__heading">{strings.limits}</h4>
            <ul className="w-guide__limits">
              {text.underTheHood.limits.map((limit, index) => (
                <li key={index}>{limit}</li>
              ))}
            </ul>
          </>
        )}
      </details>
      {page === undefined ? null : (
        <ExternalLink url={githubFileUrl(page, version)} title={strings.openOnGitHub} className="w-guide__full-page">
          {strings.fullPage} ↗
        </ExternalLink>
      )}
    </article>
  )
}

/** The Guide's dialog; mounted by GuideHost.tsx while the Guide is open. */
export default function GuideWindow() {
  const selected = useGuide((state) => state.topic)
  const { version, packaged } = useGuide((state) => state.build)
  const chosen = useAppSettings((settings) => settings.guideLanguage)
  const language = guideLanguage(chosen, navigator.languages)
  const strings = GUIDE_STRINGS[language]
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLElement>(null)

  const topics = shownTopics(packaged).flatMap((entry) => {
    const topic = GUIDE_CONTENT.get(entry.id)
    return topic === undefined ? [] : [topic]
  })
  const current = topics.find((topic) => topic.id === selected) ?? topics[0]

  // On opening: the guard learns the dialog and the focus goes to the Topic on screen in the list;
  // on closing it goes back to what had it before, if that is still on the page. A layout effect:
  // no key may fall between the dialog appearing and the guard knowing it.
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setGuideDialogElement(dialog.current)
    ;(list.current?.querySelector<HTMLElement>('[aria-current="true"]') ?? dialog.current)?.focus()
    return () => {
      setGuideDialogElement(null)
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  return createPortal(
    <div
      className="w-guide__backdrop"
      style={{ zIndex: SETTINGS_LAYER }}
      data-testid="guide-backdrop"
      // A press on the backdrop closes the Guide and does not take the focus out of it first.
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        closeGuide()
      }}
    >
      <div ref={dialog} className="w-guide" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-testid="guide" data-language={language}>
        <header className="w-guide__header">
          <h2 id={titleId} className="w-guide__title">
            {strings.title}
          </h2>
          <div className="w-guide__languages" role="group" aria-label={strings.language}>
            {GUIDE_LANGUAGES.map((each) => (
              <button
                key={each}
                type="button"
                className="w-guide__language"
                aria-pressed={each === language}
                data-testid={`guide-language-${each}`}
                onClick={() => void setAppSettings({ guideLanguage: each }).then((problem) => problem !== undefined && console.error('appSettings.set failed:', problem))}
              >
                {each.toUpperCase()}
              </button>
            ))}
          </div>
          <button type="button" className="w-action" data-testid="guide-close" onClick={closeGuide}>
            {strings.close}
          </button>
        </header>
        <div className="w-guide__body">
          <nav ref={list} className="w-guide__list" aria-label={strings.topics}>
            <h3 className="w-guide__heading">{strings.topics}</h3>
            <ul>
              {topics.map((topic) => (
                <li key={topic.id}>
                  <button
                    type="button"
                    className="w-guide__list-item"
                    aria-current={topic === current}
                    data-testid="guide-topic-item"
                    data-topic={topic.id}
                    onClick={() => selectGuideTopic(topic.id)}
                  >
                    {topic.text[language].title}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="w-guide__content">
            {current === undefined ? (
              <p className="w-guide__text" data-testid="guide-empty">
                {strings.noTopics}
              </p>
            ) : (
              <TopicView key={current.id} topic={current} language={language} strings={strings} version={version} />
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
