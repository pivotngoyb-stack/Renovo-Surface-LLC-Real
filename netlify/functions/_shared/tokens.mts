import { randomBytes } from 'node:crypto'

/** Unguessable URL-safe token for public estimate/work-order links. */
export function generateToken(): string {
  return randomBytes(24).toString('base64url')
}
