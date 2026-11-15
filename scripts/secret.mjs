// Gera um segredo de 32 bytes em base64url para o .env (CSRF_SECRET, PASSWORD_PEPPER_V1...).
import { randomBytes } from 'node:crypto'

console.log(randomBytes(32).toString('base64url'))
