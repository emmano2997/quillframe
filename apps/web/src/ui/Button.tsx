import type { ButtonHTMLAttributes } from 'react'
import { playClick } from './sounds.ts'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  wide?: boolean
}

export function Button({ wide = false, className, type = 'button', onClick, ...props }: ButtonProps) {
  const classes = ['qf-button', wide ? 'qf-button-wide' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <button
      type={type}
      className={classes}
      onClick={(event) => {
        playClick()
        onClick?.(event)
      }}
      {...props}
    />
  )
}
