export interface KassenmeldungInput {
  betrieb: { name: string; street?: string; plz?: string; city?: string; finanzamtNr?: string }
  kasse: { id: string; name: string; serialNr?: string; swBrand?: string; swVersion?: string }
  tse: { provider: string; serial?: string; certificate?: string; inUseSince?: string }
  acquisition?: { kind: string; date?: string }
}

export interface KassenmeldungPayload {
  meldung: string
  betrieb: KassenmeldungInput['betrieb']
  kasse: KassenmeldungInput['kasse']
  tse: KassenmeldungInput['tse']
  acquisition?: KassenmeldungInput['acquisition']
  /** Sempre false: esta fatia NÃO submete ao ELSTER (validação externa). */
  submitted: boolean
}

/**
 * Monta a representação estruturada da Kassenmeldung (§146a Abs. 4 AO): Betriebsstätte,
 * Kasse, TSE e tipo/início de uso. NÃO submete ao ELSTER (ERiC + certificados + ambiente
 * credenciado = validação externa). O conjunto exato de campos = spec ELSTER/Steuerberater.
 */
export function buildKassenmeldung(input: KassenmeldungInput): KassenmeldungPayload {
  return {
    meldung: 'Mitteilung nach §146a Abs. 4 AO',
    betrieb: input.betrieb,
    kasse: input.kasse,
    tse: input.tse,
    acquisition: input.acquisition,
    submitted: false,
  }
}
