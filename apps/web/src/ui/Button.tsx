import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  wide?: boolean
}

export function Button({ wide = false, className, type = 'button', ...props }: ButtonProps) {
  const classes = [styles.button, wide ? styles.wide : '', className ?? ''].filter(Boolean).join(' ')
  return <button type={type} className={classes} {...props} />
}
