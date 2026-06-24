import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'

/** Hash de senha/PIN com Argon2 (binários pré-compilados, sem node-gyp). */
export async function hashSecret(secret: string): Promise<string> {
  return argonHash(secret)
}

export async function verifySecret(hash: string, secret: string): Promise<boolean> {
  try {
    return await argonVerify(hash, secret)
  } catch {
    return false
  }
}
