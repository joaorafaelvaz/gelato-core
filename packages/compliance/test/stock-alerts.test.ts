import { describe, it, expect } from 'vitest'
import { classifyStockAlert, stockAlerts } from '../src/stock/alerts'

describe('classifyStockAlert', () => {
  it('negative when qty < 0 (even without minStock)', () => {
    expect(classifyStockAlert(-1, 100)).toBe('negative')
    expect(classifyStockAlert(-1, null)).toBe('negative')
  })
  it('low when 0 <= qty < minStock', () => {
    expect(classifyStockAlert(0, 100)).toBe('low')
    expect(classifyStockAlert(99, 100)).toBe('low')
  })
  it('ok at or above minStock, or without minStock', () => {
    expect(classifyStockAlert(100, 100)).toBe('ok') // == min → ok
    expect(classifyStockAlert(150, 100)).toBe('ok')
    expect(classifyStockAlert(0, null)).toBe('ok') // sem minStock, não negativo
  })
})

describe('stockAlerts', () => {
  it('filters out ok and orders negative before low, then by qty asc', () => {
    const out = stockAlerts([
      { id: 'a', qty: 150, minStock: 100 }, // ok
      { id: 'b', qty: 80, minStock: 100 }, // low
      { id: 'c', qty: -5, minStock: 100 }, // negative
      { id: 'd', qty: 20, minStock: 100 }, // low (menor que b)
      { id: 'e', qty: 500, minStock: null }, // ok
    ])
    expect(out.map((x) => [x.id, x.state])).toEqual([
      ['c', 'negative'],
      ['d', 'low'],
      ['b', 'low'],
    ])
  })

  it('empty when everything is ok', () => {
    expect(stockAlerts([{ id: 'a', qty: 100, minStock: 100 }, { id: 'b', qty: 5, minStock: null }])).toEqual([])
  })
})
