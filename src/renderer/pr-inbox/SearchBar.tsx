// The search bar of the Pull requests view (worfy-pr-review ticket 05; spec, Solution 1, implementation decisions 1 and
// 12; the prototype of ticket 01, states `search`, `scope`, `saved`, `savepop` and `filter`): the scope menu, the
// field with the menu of saved searches, ☆ Save, Clear, and the row of filter chips.
//
// The field is the one source of truth: a chip writes its qualifiers into it (setChip of src/shared/pr-search/query.ts)
// and shows the ones the field already holds, whoever typed them. Enter searches, a chip, a scope or a saved search
// searches at once; typing alone never does (GitHub's search has a small rate limit). What GitHub would refuse — over
// 256 characters, more than 5 AND/OR/NOT — is said under the field before Enter; GitHub's own 422 words after it, the
// field framed red. Saving and forgetting write the Project's data folder: on a read-only screen of a Linked machine
// ☆ Save is inactive with the hint and Forget is not offered.
import { useState, type KeyboardEvent, type RefObject } from 'react'
import { PR_SEARCH_NAME_MAX, type SavedSearch } from '../../shared/ipc/pr-search'
import { chipsOf, PR_SEARCH_CHIPS, PR_SEARCH_SCOPE_TITLES, PR_SEARCH_SCOPES, searchWarnings, setChip, type PrSearchChip, type PrSearchChipDefinition, type PrSearchScope, type SearchWarning } from '../../shared/pr-search/query'
import { writeAction } from '../projects/read-only'
import { Button } from '../theme/Button'
import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../theme/kit/Menu'
import { Popover } from '../theme/kit/Popover'
import type { PrSearch } from './usePrInbox'
import './pr-search.css'

/** What each scope of the menu says under its title. */
const SCOPE_TEXT: Readonly<Record<PrSearchScope, string>> = {
  project: 'The repositories of this Project',
  owners: 'Every repository of the owners of its repositories',
  github: 'Everything your GitHub account can see',
}

/** The chips of one qualifier: a press writes it or takes it out, no menu. */
const TOGGLES: ReadonlySet<PrSearchChip> = new Set(['involves', 'reviewedBy', 'reviewInvolves'])

/** The chips that take any value besides their options: the menu puts `<key>:` into the field for it to be typed. */
const TYPED: Partial<Record<PrSearchChip, { item: string; key: string }>> = {
  author: { item: 'Type a login…', key: 'author:' },
  label: { item: 'Type a label…', key: 'label:' },
}

const lower = (text: string): string => text.toLowerCase()

/** What a chip shows of the qualifiers the field holds: an option's label, else the value after the colon. */
function chipValue(chip: PrSearchChipDefinition, tokens: readonly string[]): string {
  return tokens
    .map((token) => chip.options.find((option) => lower(option.qualifier) === lower(token))?.label ?? token.slice(token.indexOf(':') + 1).replaceAll('"', ''))
    .join(', ')
}

function warningText(warning: SearchWarning): string {
  return warning.kind === 'too-long'
    ? `GitHub refuses a search over 256 characters: this one has ${warning.length}.`
    : `GitHub refuses more than 5 AND, OR and NOT: this search has ${warning.count}.`
}

function SearchIcon() {
  return (
    <svg className="w-pr-search__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  )
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg className="w-pr-search__icon" viewBox="0 0 16 16" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" aria-hidden="true">
      <path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
    </svg>
  )
}

export interface SearchBarProps {
  search: PrSearch
  /** The logins the Author chip offers besides Me: the authors of the rows shown. */
  authors: readonly string[]
  /** The read-only hint of a Linked machine's screen: ☆ Save is inactive with it. */
  readOnly: string | null
  /** GitHub's words of a 422 for the search in the field; null — none. */
  invalid: string | null
  /** The saved search the field and the scope are, if any. */
  savedHit: SavedSearch | null
  fieldRef: RefObject<HTMLInputElement | null>
}

/** The scope menu: This Project, the organizations of the Project, All of GitHub. */
function ScopeMenu({ scope, onScope }: { scope: PrSearchScope; onScope: (scope: PrSearchScope) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      label="Search in"
      testId="pr-search-scope-menu"
      className="w-pr-search__menu"
      focusOnOpen='[aria-checked="true"]'
      trigger={
        <button type="button" className="w-pr-search__dropdown" data-testid="pr-search-scope" title="Where to search">
          {PR_SEARCH_SCOPE_TITLES[scope]}
          <span className="w-pr-search__caret" aria-hidden="true">
            ▾
          </span>
        </button>
      }
    >
      <MenuRadioGroup value={scope} onValueChange={(next) => onScope(next as PrSearchScope)} heading="Search in" headingClassName="w-pr-search__menu-heading">
        {PR_SEARCH_SCOPES.map((each) => (
          <MenuRadioItem key={each} value={each} className="w-pr-search__item" testId="pr-search-scope-item" data-scope={each} closeOnClick>
            <span className="w-pr-search__item-text">
              {PR_SEARCH_SCOPE_TITLES[each]}
              <span className="w-pr-search__item-note">{SCOPE_TEXT[each]}</span>
            </span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </Menu>
  )
}

/** The menu of the field: the saved searches, built-in first; Forget for the user's own search the field is. */
function SavedMenu({ saved, hit, readOnly, onRun, onForget }: { saved: readonly SavedSearch[]; hit: SavedSearch | null; readOnly: string | null; onRun: (search: SavedSearch) => void; onForget: (search: SavedSearch) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      label="Saved searches"
      testId="pr-search-saved-menu"
      className="w-pr-search__menu"
      align="end"
      trigger={
        <button type="button" className="w-pr-search__field-menu" data-testid="pr-search-saved" aria-label="Saved searches" title="Saved searches">
          ▾
        </button>
      }
    >
      <span className="w-pr-search__menu-heading">Saved searches</span>
      {saved.map((each) => (
        <MenuItem key={each.id} className="w-pr-search__item" testId="pr-search-saved-item" data-id={each.id} onClick={() => onRun(each)}>
          <span className="w-pr-search__item-icon" aria-hidden="true">
            <Star filled />
          </span>
          <span className="w-pr-search__item-text">
            {each.name}
            <span className="w-pr-search__item-query w-mono">
              {each.query} · {PR_SEARCH_SCOPE_TITLES[each.scope]}
            </span>
          </span>
        </MenuItem>
      ))}
      {hit !== null && !hit.builtIn && readOnly === null ? (
        <>
          <MenuSeparator className="w-pr-search__menu-separator" />
          <MenuItem className="w-pr-search__item" testId="pr-search-forget" onClick={() => onForget(hit)}>
            <span className="w-pr-search__item-text">Forget “{hit.name}”</span>
          </MenuItem>
        </>
      ) : null}
    </Menu>
  )
}

/** ☆ Save: a name for the search in the field and its scope; ★ Saved when it is one already. */
function SaveButton({ search, hit, readOnly }: { search: PrSearch; hit: SavedSearch | null; readOnly: string | null }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const query = search.text.trim()
  const canSave = query !== '' && hit === null && readOnly === null
  const change = (next: boolean): void => {
    if (next && !canSave) return
    if (next) {
      setName(query.slice(0, PR_SEARCH_NAME_MAX))
      setError(null)
    }
    setOpen(next)
  }
  const confirm = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    void search.save(trimmed).then((refused) => {
      if (refused === null) setOpen(false)
      else setError(`Not saved: ${refused}`)
    })
  }
  const props = hit !== null ? { 'aria-pressed': true, 'aria-disabled': true, title: `Saved as ${hit.name}` } : writeAction(readOnly, () => undefined, 'Save this search')
  return (
    <Popover
      open={open}
      onOpenChange={change}
      label="Save search"
      testId="pr-search-save-popover"
      className="w-pr-search__save"
      align="end"
      trigger={
        <Button data-testid="pr-search-save" className="w-pr-search__button" disabled={query === ''} icon={<Star filled={hit !== null} />} {...props}>
          {hit !== null ? 'Saved' : 'Save'}
        </Button>
      }
    >
      <label className="w-pr-search__save-label" htmlFor="pr-search-save-name">
        Name
      </label>
      <input
        id="pr-search-save-name"
        className="w-pr-search__save-input"
        data-testid="pr-search-save-name"
        value={name}
        maxLength={PR_SEARCH_NAME_MAX}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') confirm()
        }}
      />
      <div className="w-pr-search__save-query w-mono">
        {query} · {PR_SEARCH_SCOPE_TITLES[search.scope]}
      </div>
      {error !== null ? (
        <p className="w-pr-search__error" role="alert" data-testid="pr-search-save-error">
          {error}
        </p>
      ) : null}
      <div className="w-pr-search__save-actions">
        <Button onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="primary" data-testid="pr-search-save-confirm" disabled={name.trim() === ''} onClick={confirm}>
          Save
        </Button>
      </div>
    </Popover>
  )
}

/** One filter chip: a press of a toggle, or a menu of the qualifiers it writes. */
function FilterChip({ chip, text, authors, onWrite, onType }: { chip: PrSearchChipDefinition; text: string; authors: readonly string[]; onWrite: (qualifiers: string[]) => void; onType: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  const tokens = chipsOf(text)[chip.id] ?? []
  const pressed = tokens.length > 0
  if (TOGGLES.has(chip.id)) {
    const qualifier = chip.options[0]!.qualifier
    return (
      <button type="button" className="w-pr-search__chip" data-testid="pr-search-chip" data-chip={chip.id} aria-pressed={pressed} title={qualifier} onClick={() => onWrite(pressed ? [] : [qualifier])}>
        {pressed ? '✓ ' : null}
        {chip.label}
      </button>
    )
  }
  const options = chip.id === 'author' ? [...chip.options, ...authors.map((login) => ({ label: login, qualifier: `author:${login}` }))] : chip.options
  const value = options.find((option) => tokens.length === 1 && lower(option.qualifier) === lower(tokens[0]!))?.qualifier ?? null
  const typed = TYPED[chip.id]
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      label={chip.label}
      testId="pr-search-chip-menu"
      className="w-pr-search__menu"
      trigger={
        <button type="button" className="w-pr-search__chip" data-testid="pr-search-chip" data-chip={chip.id} aria-pressed={pressed}>
          {chip.label}
          {pressed ? (
            <>
              :<span className="w-pr-search__chip-value">{chipValue(chip, tokens)}</span>
            </>
          ) : null}
          <span className="w-pr-search__caret" aria-hidden="true">
            ▾
          </span>
        </button>
      }
    >
      {options.length > 0 ? (
        <MenuRadioGroup value={value} onValueChange={(qualifier) => onWrite([qualifier])} heading={chip.label} headingClassName="w-pr-search__menu-heading">
          {options.map((option) => (
            <MenuRadioItem key={option.qualifier} value={option.qualifier} className="w-pr-search__item" testId="pr-search-chip-option" closeOnClick>
              <span className="w-pr-search__item-text">{option.label}</span>
              <span className="w-pr-search__item-query w-mono">{option.qualifier}</span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      ) : (
        <span className="w-pr-search__menu-heading">{chip.label}</span>
      )}
      {typed !== undefined ? (
        <MenuItem className="w-pr-search__item" onClick={() => onType(typed.key)}>
          <span className="w-pr-search__item-text">{typed.item}</span>
        </MenuItem>
      ) : null}
      {pressed ? (
        <>
          <MenuSeparator className="w-pr-search__menu-separator" />
          <MenuItem className="w-pr-search__item" onClick={() => onWrite([])}>
            <span className="w-pr-search__item-text">Remove the filter</span>
          </MenuItem>
        </>
      ) : null}
    </Menu>
  )
}

/** The scope menu, the field, ☆ Save, Clear and the filter chips. */
export function SearchBar({ search, authors, readOnly, invalid, savedHit, fieldRef }: SearchBarProps) {
  const warnings = searchWarnings({ text: search.text, scope: search.scope, repos: [] })
  const write = (text: string): void => {
    search.setText(text)
    search.run(text)
  }
  const focusEnd = (): void => {
    // After the menu has given the focus back to its trigger.
    setTimeout(() => {
      const field = fieldRef.current
      if (field === null) return
      field.focus()
      field.setSelectionRange(field.value.length, field.value.length)
    }, 0)
  }
  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      search.run()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.currentTarget.blur()
    }
  }
  const runSaved = (each: SavedSearch): void => {
    search.setText(each.query)
    search.run(each.query, each.scope)
  }
  return (
    <div className="w-pr-search" data-testid="pr-search-bar">
      <div className="w-pr-search__row">
        <ScopeMenu scope={search.scope} onScope={search.setScope} />
        <div className="w-pr-search__field" data-invalid={invalid !== null ? 'true' : undefined}>
          <SearchIcon />
          <input
            ref={fieldRef}
            className="w-pr-search__input"
            role="searchbox"
            aria-label="Search pull requests"
            aria-invalid={invalid !== null}
            aria-describedby={invalid !== null || warnings.length > 0 ? 'pr-search-field-notes' : undefined}
            placeholder="Search pull requests… text and GitHub qualifiers"
            autoComplete="off"
            spellCheck={false}
            value={search.text}
            data-testid="pr-search-field"
            onChange={(event) => search.setText(event.target.value)}
            onKeyDown={onKey}
          />
          {search.text === '' ? (
            <kbd className="w-pr-search__kbd" title="Press / to search">
              /
            </kbd>
          ) : null}
          <SavedMenu saved={search.saved} hit={savedHit} readOnly={readOnly} onRun={runSaved} onForget={(each) => void search.forget(each.id)} />
        </div>
        <SaveButton search={search} hit={savedHit} readOnly={readOnly} />
        <Button className="w-pr-search__button" data-testid="pr-search-clear" disabled={search.text === '' && search.shown === null} title="Clear the search and show the inbox" onClick={search.clear}>
          × Clear
        </Button>
      </div>
      {invalid !== null || warnings.length > 0 ? (
        <div className="w-pr-search__notes" id="pr-search-field-notes">
          {invalid !== null ? (
            <p className="w-pr-search__error" role="alert" data-testid="pr-search-invalid">
              {invalid}
            </p>
          ) : null}
          {warnings.map((warning) => (
            <p key={warning.kind} className="w-pr-search__warning" data-testid="pr-search-warning">
              {warningText(warning)}
            </p>
          ))}
        </div>
      ) : null}
      <div className="w-pr-search__chips" role="group" aria-label="Filters">
        {PR_SEARCH_CHIPS.map((chip) => (
          <FilterChip
            key={chip.id}
            chip={chip}
            text={search.text}
            authors={authors}
            onWrite={(qualifiers) => write(setChip(search.text, chip.id, qualifiers))}
            onType={(key) => {
              search.setText(`${search.text.trim()} ${key}`.trimStart())
              focusEnd()
            }}
          />
        ))}
      </div>
    </div>
  )
}
