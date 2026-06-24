import { SetMetadata } from '@nestjs/common'

export const PERMISSION_KEY = 'required_permission'

/** Marca a permissão exigida por um handler/controller (verificada pelo PermissionsGuard). */
export const RequirePermission = (permission: string) => SetMetadata(PERMISSION_KEY, permission)
