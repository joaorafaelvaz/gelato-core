import { BadRequestException } from '@nestjs/common'
import type { ZodSchema } from 'zod'

/** Valida com zod e lança 400 (BadRequest) em caso de payload inválido. */
export function parseOrThrow<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new BadRequestException(result.error.flatten())
  }
  return result.data
}
