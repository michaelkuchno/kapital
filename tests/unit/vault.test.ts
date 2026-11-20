import { describe, expect, it } from 'vitest'
import { seal, open } from '@web/vault'

describe('encrypted backup (AES-GCM + PBKDF2)', () => {
  const data = { v: 1, assets: [{ id: 'edo', kind: 'bond', count: 2_500 }], settings: { monthlyExpenses: 12_000 } }
  it('round trip with the right password; the file contains no plain data', async () => {
    const v = await seal(data, 'correct horse battery')
    expect(JSON.stringify(v)).not.toContain('2500')
    expect(JSON.stringify(v)).not.toContain('edo')
    expect(await open(v, 'correct horse battery')).toEqual(data)
  })
  it('wrong password or tampered data fail', async () => {
    const v = await seal(data, 'correct horse battery')
    await expect(open(v, 'wrong password!')).rejects.toThrow()
    const bad = { ...v, data: v.data.slice(0, -4) + 'AAAA' }
    await expect(open(bad, 'correct horse battery')).rejects.toThrow()
    await expect(open({ ...v, v: 2 as 1 }, 'correct horse battery')).rejects.toThrow()
  })
  it('a short password is refused; every backup uses a fresh salt and IV', async () => {
    await expect(seal(data, 'short')).rejects.toThrow()
    const a = await seal(data, 'correct horse battery')
    const b = await seal(data, 'correct horse battery')
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
  })
})
