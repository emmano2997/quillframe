// Lê os e-mails que a API mandou para o Mailpit (docker compose) pela API HTTP dele.
import { expect } from '@playwright/test'
import { MAILPIT_URL } from './env.ts'

interface Summary {
  ID: string
  Subject: string
}

/** Espera chegar um e-mail para `to` e devolve o primeiro link do site que estiver no texto. */
export async function linkFromEmail(to: string, path: string): Promise<string> {
  let link: string | null = null
  await expect
    .poll(
      async () => {
        const query = encodeURIComponent(`to:"${to}"`)
        const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`)
        const { messages } = (await search.json()) as { messages: Summary[] }
        for (const message of messages) {
          const full = await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
          const { Text } = (await full.json()) as { Text: string }
          const found = Text.split(/\s+/).find((word) => word.includes(`${path}#token=`))
          if (found) link = found
        }
        return link
      },
      { message: `e-mail com ${path} para ${to}`, timeout: 15_000 },
    )
    .not.toBeNull()
  return link as unknown as string
}
