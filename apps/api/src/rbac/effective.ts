/** Funções acumuláveis: as permissões efetivas são a UNIÃO das permissões dos roles. */
export function effectivePermissions(roles: { permissions: { key: string }[] }[]): string[] {
  const set = new Set<string>()
  for (const role of roles) {
    for (const p of role.permissions) set.add(p.key)
  }
  return [...set].sort()
}
