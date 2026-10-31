// The language the worfy Guide is read in (worfy-guide ticket 03, ADR-0090). English is the main
// version, Russian a full one. The person's choice — the EN / RU switch in the Guide's header, kept
// in the app settings (`guideLanguage`) — wins; without one the Guide follows the first language of
// the system. Only the Guide switches: the rest of the window stays English.
import type { GuideLanguage } from '../../shared/settings/app-settings'

/** Russian when the first preferred language of the system is Russian (`ru`, `ru-RU`), else English. */
export function systemGuideLanguage(languages: readonly string[]): GuideLanguage {
  const first = languages[0]?.toLowerCase() ?? ''
  return first === 'ru' || first.startsWith('ru-') ? 'ru' : 'en'
}

/** The person's choice, else the system's language. */
export function guideLanguage(chosen: GuideLanguage | undefined, languages: readonly string[]): GuideLanguage {
  return chosen ?? systemGuideLanguage(languages)
}
