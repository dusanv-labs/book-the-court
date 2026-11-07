import { randomBytes, randomInt } from 'node:crypto';

// No 0/O or 1/I/L, so codes are easy to read out loud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Short human-friendly booking code, e.g. "K7QM3P". */
export function generateBookingCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** Unguessable token for the "manage / cancel booking" link. */
export function generateCancelToken(): string {
  return randomBytes(24).toString('base64url');
}
