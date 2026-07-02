import { useEffect, useState } from 'react'
import { apiGet, apiPut, type CustomerRow, type LoyaltyProgram, type LoyaltyView } from '../api'

export function Loyalty({ token }: { token: string }) {
  const [program, setProgram] = useState<LoyaltyProgram | null>(null)
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [balances, setBalances] = useState<Record<string, { points: number; stamps: number }>>({})

  useEffect(() => {
    apiGet<LoyaltyProgram>('/loyalty/program', token).then(setProgram).catch(() => setProgram(null))
    apiGet<CustomerRow[]>('/customers', token).then(setCustomers).catch(() => setCustomers([]))
  }, [token])

  async function save(): Promise<void> {
    if (!program) return
    await apiPut('/loyalty/program', token, { points_per_euro: program.pointsPerEuro, stamps_per_item: program.stampsPerItem, active: program.active })
  }

  async function showBalance(id: string): Promise<void> {
    const v = await apiGet<LoyaltyView>(`/customers/${id}/loyalty`, token)
    setBalances((b) => ({ ...b, [id]: v.balance }))
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <h2>Fidelidade</h2>
      {program && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label>
            Pontos/€ <input type="number" value={program.pointsPerEuro} onChange={(e) => setProgram({ ...program, pointsPerEuro: Number(e.target.value) })} />
          </label>
          <label>
            Carimbos/item <input type="number" value={program.stampsPerItem} onChange={(e) => setProgram({ ...program, stampsPerItem: Number(e.target.value) })} />
          </label>
          <label>
            Ativo <input type="checkbox" checked={program.active} onChange={(e) => setProgram({ ...program, active: e.target.checked })} />
          </label>
          <button onClick={save}>Salvar</button>
        </div>
      )}
      <ul>
        {customers.filter((c) => !c.anonymizedAt).map((c) => {
          const b = balances[c.id]
          return (
            <li key={c.id}>
              {c.name ?? c.email ?? c.id} <button onClick={() => showBalance(c.id)}>ver saldo</button>
              {b && ` — ${b.points} pts / ${b.stamps} carimbos`}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
