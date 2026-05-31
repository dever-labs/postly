// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { SendButton } from '../SendButton'

afterEach(cleanup)

describe('SendButton', () => {
  describe('idle state (isLoading=false)', () => {
    it('renders a "Send" button', () => {
      render(<SendButton onClick={vi.fn()} isLoading={false} />)
      expect(screen.getByTestId('send-button')).toBeDefined()
      expect(screen.getByText('Send')).toBeDefined()
    })

    it('calls onClick when clicked', async () => {
      const onClick = vi.fn()
      render(<SendButton onClick={onClick} isLoading={false} />)
      await userEvent.click(screen.getByTestId('send-button'))
      expect(onClick).toHaveBeenCalledOnce()
    })

    it('does not render a cancel button', () => {
      render(<SendButton onClick={vi.fn()} isLoading={false} />)
      expect(screen.queryByTestId('cancel-button')).toBeNull()
    })
  })

  describe('loading state (isLoading=true)', () => {
    it('renders a "Cancel" button', () => {
      render(<SendButton onClick={vi.fn()} isLoading={true} onCancel={vi.fn()} />)
      expect(screen.getByTestId('cancel-button')).toBeDefined()
      expect(screen.getByText('Cancel')).toBeDefined()
    })

    it('does not render the Send button', () => {
      render(<SendButton onClick={vi.fn()} isLoading={true} onCancel={vi.fn()} />)
      expect(screen.queryByTestId('send-button')).toBeNull()
    })

    it('calls onCancel when Cancel is clicked', async () => {
      const onCancel = vi.fn()
      render(<SendButton onClick={vi.fn()} isLoading={true} onCancel={onCancel} />)
      await userEvent.click(screen.getByTestId('cancel-button'))
      expect(onCancel).toHaveBeenCalledOnce()
    })

    it('does not call onClick when Cancel is clicked', async () => {
      const onClick = vi.fn()
      const onCancel = vi.fn()
      render(<SendButton onClick={onClick} isLoading={true} onCancel={onCancel} />)
      await userEvent.click(screen.getByTestId('cancel-button'))
      expect(onClick).not.toHaveBeenCalled()
    })

    it('renders cancel as non-interactive (cursor-not-allowed) when onCancel is not provided', () => {
      render(<SendButton onClick={vi.fn()} isLoading={true} />)
      const btn = screen.getByTestId('cancel-button')
      expect(btn.className).toContain('cursor-not-allowed')
    })
  })
})
