// NOT cryptographically secure — mock-only for the frontend demo.
// Real backend will replace with bcrypt/argon2 in lib/api/auth.
export function hashPassword(plain: string): string {
  let h = 5381;
  for (let i = 0; i < plain.length; i++) {
    h = ((h << 5) + h + plain.charCodeAt(i)) >>> 0;
  }
  return "mockhash:" + h.toString(16) + ":" + plain.length;
}

export function verifyPassword(plain: string, hash: string): boolean {
  return hashPassword(plain) === hash;
}
