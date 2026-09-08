import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import LoginPage from './LoginPage'

describe('LoginPage', () => {
  it('shows the seeded development sign-in', () => {
    render(<LoginPage onLogin={() => undefined} />)
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.getByDisplayValue('admin@inventory.example.com')).toBeInTheDocument()
  })
})
