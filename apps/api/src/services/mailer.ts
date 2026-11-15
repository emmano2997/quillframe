// E-mails transacionais, em inglês (documento 02, §5.6). Só texto: sem pixel de rastreamento, e os
// links apontam sempre para APP_ORIGIN. Tokens vão no fragmento da URL (#token=...).
import type { Config } from '../config.ts'

export interface Mail {
  to: string
  subject: string
  text: string
}

export interface Mailer {
  send(mail: Mail): Promise<void>
}

export interface MailLog {
  info: (obj: object, msg: string) => void
  error: (obj: object, msg: string) => void
}

/** Guarda os e-mails na memória (testes). */
export class MemoryMailer implements Mailer {
  readonly outbox: Mail[] = []

  async send(mail: Mail) {
    this.outbox.push(mail)
  }

  last(to: string): Mail | undefined {
    return this.outbox.findLast((mail) => mail.to === to)
  }

  /** Token do link do último e-mail enviado para `to`. */
  lastToken(to: string): string | undefined {
    return /#token=([A-Za-z0-9_-]+)/.exec(this.last(to)?.text ?? '')?.[1]
  }
}

function parseFrom(from: string): { name: string; email: string } {
  const match = /^([^<]*)<([^>]+)>\s*$/.exec(from)
  return match ? { name: (match[1] ?? '').trim(), email: (match[2] ?? '').trim() } : { name: '', email: from }
}

export function createMailer(config: Config, log: MailLog, fetchFn: typeof fetch = fetch): Mailer {
  const post = async (url: string, headers: Record<string, string>, body: unknown) => {
    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) log.error({ status: response.status }, 'falha ao enviar e-mail')
    } catch (err) {
      // O e-mail nunca derruba a requisição: a resposta ao usuário é a mesma (anti-enumeração)
      log.error({ err }, 'falha ao enviar e-mail')
    }
  }

  if (config.RESEND_API_KEY) {
    const key = config.RESEND_API_KEY
    return {
      send: (mail) =>
        post(
          'https://api.resend.com/emails',
          { Authorization: `Bearer ${key}` },
          { from: config.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text },
        ),
    }
  }
  if (config.MAILPIT_URL) {
    const base = config.MAILPIT_URL.replace(/\/+$/, '')
    const from = parseFrom(config.MAIL_FROM)
    return {
      send: (mail) =>
        post(
          `${base}/api/v1/send`,
          {},
          {
            From: { Name: from.name, Email: from.email },
            To: [{ Email: mail.to }],
            Subject: mail.subject,
            Text: mail.text,
          },
        ),
    }
  }
  return {
    // Desenvolvimento sem Mailpit: o e-mail aparece no log (em produção o Resend é obrigatório)
    async send(mail) {
      log.info({ to: mail.to, subject: mail.subject, text: mail.text }, 'e-mail não enviado: sem provedor')
    },
  }
}

const FOOTER = '\n\n— quillframe\nThis is an automated message. Please do not reply.'
const NOT_YOU =
  "\n\nIf this wasn't you, change your password right away and review your active sessions in Options → Security."

/** Modelos dos e-mails (documento 02, §5.6). */
export function mails(origin: string) {
  const link = (path: string, token: string) => `${origin}${path}#token=${token}`
  return {
    verifyEmail: (to: string, token: string): Mail => ({
      to,
      subject: 'Verify your email',
      text: `Welcome to quillframe!\n\nConfirm your email address to start sharing books:\n${link('/verify-email', token)}\n\nThis link expires in 24 hours. If you didn't create an account, you can ignore this email.${FOOTER}`,
    }),
    confirmNewEmail: (to: string, token: string): Mail => ({
      to,
      subject: 'Verify your email',
      text: `Confirm this address as the new email of your quillframe account:\n${link('/verify-email', token)}\n\nThis link expires in 1 hour. If you didn't ask for this, you can ignore this email.${FOOTER}`,
    }),
    resetPassword: (to: string, token: string): Mail => ({
      to,
      subject: 'Reset your password',
      text: `Someone asked to reset the password of your quillframe account.\n\nChoose a new password:\n${link('/reset-password', token)}\n\nThis link expires in 30 minutes and can be used once. If you didn't ask for this, you can ignore this email: your password stays the same.${FOOTER}`,
    }),
    passwordChanged: (to: string): Mail => ({
      to,
      subject: 'Your password was changed',
      text: `The password of your quillframe account was just changed, and your devices were signed out.\n\nIf this wasn't you, reset your password now: ${origin}/forgot-password${FOOTER}`,
    }),
    newSignIn: (to: string, device: string, when: Date): Mail => ({
      to,
      subject: 'New sign-in to your account',
      text: `Your quillframe account was just signed in to from a new device.\n\nDevice: ${device}\nTime: ${when.toUTCString()}${NOT_YOU}${FOOTER}`,
    }),
    emailChanged: (to: string, masked: string): Mail => ({
      to,
      subject: 'Your email was changed',
      text: `The email of your quillframe account was changed to ${masked}.\n\nIf this wasn't you, reset your password now: ${origin}/forgot-password${FOOTER}`,
    }),
    mfaChanged: (to: string, on: boolean): Mail => ({
      to,
      subject: `Two-factor authentication was turned ${on ? 'on' : 'off'}`,
      text: `Two-factor authentication was just turned ${on ? 'on' : 'off'} for your quillframe account.${NOT_YOU}${FOOTER}`,
    }),
    accountExists: (to: string): Mail => ({
      to,
      subject: 'Someone tried to create an account with your email',
      text: `Someone tried to create a quillframe account with this email address, but you already have one.\n\nIf it was you, just sign in: ${origin}/login\nForgot your password? ${origin}/forgot-password\n\nIf it wasn't you, there is nothing to do: no account was created or changed.${FOOTER}`,
    }),
    failedSignIns: (to: string): Mail => ({
      to,
      subject: 'Failed sign-in attempts on your account',
      text: `There were many failed attempts to sign in to your quillframe account in the last hour.\n\nYour password was not guessed. If you use this password anywhere else, consider changing it, and turn on two-factor authentication in Options → Security.${FOOTER}`,
    }),
    moderation: (to: string, lines: string[]): Mail => ({
      to,
      subject: 'A moderation decision about your account',
      text: `${lines.join('\n')}\n\nYou can appeal this decision within 30 days in Options → Moderation History: ${origin}/settings/moderation${FOOTER}`,
    }),
    confirmConcern: (to: string, token: string): Mail => ({
      to,
      subject: 'Confirm your report to quillframe',
      text: `We received a report sent with this email address.\n\nConfirm it so our team can review it:\n${link('/report-concern', token)}\n\nThis link expires in 24 hours. If you didn't send a report, you can ignore this email.${FOOTER}`,
    }),
    adminAlert: (to: string, what: string): Mail => ({
      to,
      subject: `[quillframe] ${what}`,
      text: `${what}\n\nOpen the moderation panel: ${origin}/mod${FOOTER}`,
    }),
  }
}

export type Mails = ReturnType<typeof mails>
