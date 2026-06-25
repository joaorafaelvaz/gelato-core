import type { Cents } from '@gelato/domain'

// ---- Caixa do turno (Kassensturz) ----
export interface ShiftCashInput {
  openingFloat: Cents
  cashSales: Cents
  suprimentos: Cents
  sangrias: Cents
  counted: Cents
}
export interface ShiftCashResult {
  expected: Cents
  counted: Cents
  differenz: Cents
}

// ---- Totais de dia (X/Z-Bericht) ----
export interface ReportLine {
  mwstRate: number
  net: Cents
  gross: Cents
}
export interface ReportPayment {
  method: string
  amount: Cents
}
export interface DayTotalsInput {
  lines: ReportLine[]
  payments: ReportPayment[]
  receiptCount: number
  stornoCount: number
  priorGrandTotal: Cents
}
export interface VatGroup {
  rate: number
  net: Cents
  mwst: Cents
  gross: Cents
}
export interface PaymentGroup {
  method: string
  amount: Cents
}
export interface DayTotals {
  byVatRate: VatGroup[]
  byPayment: PaymentGroup[]
  totalNet: Cents
  totalMwst: Cents
  totalGross: Cents
  receiptCount: number
  stornoCount: number
  grandTotal: Cents
}
