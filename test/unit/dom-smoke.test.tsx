import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/renderer/main'

describe('renderer in jsdom', () => {
  it('renders the App component', () => {
    render(<App />)
    expect(screen.getByText('worfy')).toBeTruthy()
  })
})
