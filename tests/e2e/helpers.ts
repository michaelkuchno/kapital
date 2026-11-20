import { expect, type Page } from '@playwright/test'

export const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
export const num = async (page: Page, testId: string) => Number(await page.getByTestId(testId).getAttribute('data-value'))

export async function addBond(page: Page, amount: string, purchase: string) {
  await page.getByTestId('nav-assets').click()
  await page.getByTestId('add-asset').click()
  await page.getByTestId('kind-bond').click()
  await page.getByTestId('f-code').selectOption('EDO')
  await page.getByTestId('f-purchase').fill(purchase)
  await page.getByTestId('f-bond-amount').fill(amount)
  await page.getByTestId('f-firstRate').fill('5,6')
  await page.getByTestId('f-margin').fill('2')
  await page.getByTestId('f-save').click()
  await expect(page.getByTestId('asset-form')).toBeHidden()
}
export async function addDeposit(page: Page) {
  await page.getByTestId('nav-assets').click()
  await page.getByTestId('add-asset').click()
  await page.getByTestId('kind-deposit').click()
  await page.getByTestId('f-bank').fill('BankX')
  await page.getByTestId('f-amount').fill('60 000')
  await page.getByTestId('f-rate').fill('6,5')
  await page.getByTestId('f-start').fill(iso(-70))
  await page.getByTestId('f-months').fill('3')
  await page.getByTestId('f-renew').fill('4')
  await page.getByTestId('f-save').click()
  await expect(page.getByTestId('asset-form')).toBeHidden()
}
export async function addStock(page: Page, name: string, qty: string, cost: string) {
  await page.getByTestId('nav-assets').click()
  await page.getByTestId('add-asset').click()
  await page.getByTestId('kind-stock').click()
  await page.getByTestId('f-share').fill(name)
  await page.getByTestId('f-quantity').fill(qty)
  await page.getByTestId('f-cost').fill(cost)
  await page.getByTestId('f-save').click()
  await expect(page.getByTestId('asset-form')).toBeHidden()
}
