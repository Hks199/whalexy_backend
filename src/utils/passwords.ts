import argon2 from 'argon2';
import bcrypt from 'bcryptjs';

export const hashPassword = (value: string) =>
  argon2.hash(value, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
export async function verifyPassword(hash: string, password: string) {
  const legacy = hash.match(/^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/);
  if (legacy) {
    // Avoid silent bcrypt truncation and unreasonable work factors from an import.
    if (Number(legacy[1]) < 4 || Number(legacy[1]) > 14 || bcrypt.truncates(password))
      return { valid: false, needsUpgrade: false };
    return { valid: await bcrypt.compare(password, hash).catch(() => false), needsUpgrade: true };
  }
  const parameters = hash.match(/^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/);
  if (
    !parameters ||
    hash.length > 512 ||
    Number(parameters[1]) > 65536 ||
    Number(parameters[2]) > 4 ||
    Number(parameters[3]) > 4
  )
    return { valid: false, needsUpgrade: false };
  return { valid: await argon2.verify(hash, password).catch(() => false), needsUpgrade: false };
}
