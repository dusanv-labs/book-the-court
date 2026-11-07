import { z } from 'zod';
import { isValidDateString } from './time.js';

export const sportSchema = z.enum(['PADEL', 'TENNIS', 'FOOTBALL']);
export const dayTypeSchema = z.enum(['WEEKDAY', 'WEEKEND']);

/** Local calendar date, YYYY-MM-DD. */
export const dateSchema = z.string().refine(isValidDateString, 'Expected a valid date in YYYY-MM-DD format');

export const idSchema = z.uuid();

/** Minute of day aligned to 30 minutes, 0..1440. */
export const minuteSchema = z
  .number()
  .int()
  .min(0)
  .max(24 * 60)
  .refine((m) => m % 30 === 0, 'Must be a multiple of 30 minutes');
