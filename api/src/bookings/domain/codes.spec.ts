import { generateBookingCode, generateCancelToken } from './codes.js';

describe('booking codes', () => {
  it('generates readable 6-character codes without ambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateBookingCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);
    }
  });

  it('generates unique, URL-safe cancel tokens', () => {
    const tokens = new Set(Array.from({ length: 500 }, generateCancelToken));
    expect(tokens.size).toBe(500);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});
