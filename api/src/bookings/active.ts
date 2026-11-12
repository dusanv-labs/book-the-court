import type { Prisma } from '../generated/prisma/client.js';

/**
 * Bookings that occupy their court: confirmed ones, and ones still waiting for online payment
 * whose hold has not run out. Combine with other conditions in a Prisma `where`.
 */
export function occupyingBookings(now = new Date()): Prisma.BookingWhereInput {
  return { OR: [{ status: 'CONFIRMED' }, { status: 'PENDING', holdExpiresAt: { gt: now } }] };
}
