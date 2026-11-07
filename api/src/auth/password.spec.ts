import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies the correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^scrypt\$/);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('uses a random salt, so equal passwords give different hashes', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });
});
