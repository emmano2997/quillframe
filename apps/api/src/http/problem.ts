// Erros no formato RFC 9457 (application/problem+json) com um `code` estável para o front
// (documento 02, §4.1).
import type { FastifyError, FastifyInstance } from 'fastify'
import { ZodError } from 'zod'

export const PROBLEMS = {
  VALIDATION_FAILED: { status: 400, detail: 'Some fields are invalid.' },
  UNAUTHENTICATED: { status: 401, detail: 'Please sign in to continue.' },
  INVALID_CREDENTIALS: { status: 401, detail: 'Invalid email or password.' },
  MFA_REQUIRED: { status: 401, detail: 'Enter the code from your authenticator app.' },
  CSRF_FAILED: { status: 403, detail: 'Your session expired. Please reload the page.' },
  REAUTH_REQUIRED: { status: 403, detail: 'Please confirm your password to continue.' },
  CAPTCHA_REQUIRED: { status: 403, detail: 'Please complete the verification.' },
  EMAIL_NOT_VERIFIED: { status: 403, detail: 'Please verify your email first.' },
  ACCOUNT_SUSPENDED: { status: 403, detail: 'Your account is suspended.' },
  FORBIDDEN: { status: 403, detail: "You can't do this." },
  MFA_SETUP_REQUIRED: {
    status: 403,
    detail: 'Turn on two-factor authentication to open the moderation panel.',
  },
  NOT_FOUND: { status: 404, detail: 'Not found.' },
  CONFLICT: { status: 409, detail: 'This was already done.' },
  VERSION_CONFLICT: { status: 409, detail: 'This book was changed somewhere else.' },
  BOOK_SIGNED: { status: 409, detail: 'Signed books can no longer be edited.' },
  PAYLOAD_TOO_LARGE: { status: 413, detail: 'This request is too large.' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, detail: 'Requests must be sent as JSON.' },
  BREACHED_PASSWORD: {
    status: 422,
    detail: 'This password has appeared in a data breach. Please choose a different one.',
  },
  WEAK_PASSWORD: {
    status: 422,
    detail: 'This password is too easy to guess. Please choose a different one.',
  },
  NAME_NOT_ALLOWED: { status: 422, detail: "This name isn't allowed." },
  LIMIT_REACHED: { status: 422, detail: 'You have reached the limit.' },
  RATE_LIMITED: { status: 429, detail: 'Too many attempts. Please wait and try again.' },
  INTERNAL: { status: 500, detail: 'Something went wrong. Please try again.' },
} as const satisfies Record<string, { status: number; detail: string }>

export type ProblemCode = keyof typeof PROBLEMS

export interface FieldIssue {
  field: string
  message: string
}

export class ApiError extends Error {
  readonly code: ProblemCode
  readonly status: number
  readonly detail: string
  readonly fields: FieldIssue[] | undefined
  readonly headers: Record<string, string> | undefined
  /** Campos extras no corpo do erro (ex.: a versão atual num VERSION_CONFLICT) */
  readonly extra: Record<string, unknown> | undefined

  constructor(
    code: ProblemCode,
    options: {
      detail?: string
      fields?: FieldIssue[]
      headers?: Record<string, string>
      extra?: Record<string, unknown>
    } = {},
  ) {
    super(code)
    this.code = code
    this.status = PROBLEMS[code].status
    this.detail = options.detail ?? PROBLEMS[code].detail
    this.fields = options.fields
    this.headers = options.headers
    this.extra = options.extra
  }
}

export function fieldsFromZod(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }))
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  if (error instanceof ZodError) return new ApiError('VALIDATION_FAILED', { fields: fieldsFromZod(error) })
  const fastifyError = error as Partial<FastifyError>
  switch (fastifyError.code) {
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return new ApiError('PAYLOAD_TOO_LARGE')
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return new ApiError('UNSUPPORTED_MEDIA_TYPE')
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
      return new ApiError('VALIDATION_FAILED', { detail: 'The request body is not valid JSON.' })
  }
  if (fastifyError.statusCode === 400 && fastifyError.name === 'SyntaxError') {
    return new ApiError('VALIDATION_FAILED', { detail: 'The request body is not valid JSON.' })
  }
  return new ApiError('INTERNAL')
}

export function registerProblemHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const problem = toApiError(error)
    // Só erros inesperados vão para o log com a pilha; nunca o corpo da requisição
    if (problem.code === 'INTERNAL') request.log.error({ err: error }, 'erro inesperado')

    void reply
      .code(problem.status)
      .headers(problem.headers ?? {})
      .type('application/problem+json')
      .send({
        type: 'about:blank',
        title: problem.code,
        status: problem.status,
        detail: problem.detail,
        code: problem.code,
        ...(problem.fields ? { fields: problem.fields } : {}),
        ...(problem.extra ?? {}),
      })
  })
}
