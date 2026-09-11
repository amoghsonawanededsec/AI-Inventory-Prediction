import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ChatPage from './ChatPage'

describe('ChatPage', () => {
  it('renders chat page and initial assistant message', () => {
    render(<ChatPage />)
    expect(screen.getByText(/Inventory AI assistant/i)).toBeInTheDocument()
  })
})
