import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../state'
import { db, newId, FAMILY, type StoredAsset } from '../db'
import { Card, Money, Pct, Modal, Field, Num } from '../components/ui'
import { assetName, type Asset, type ValuedAsset } from '@core/assets'
import { BOND_CODES, BOND_SPECS, bondsFor, type BondValuation, type BondCode } from '@core/bonds'
import type { DepositValuation } from '@core/deposits'
import type { PositionValuation } from '@core/stocks'
import { dateFmt, rate, money } from '../i18n'
import { LineChart } from '../components/charts'
import { loadSeries } from '../market'
import type { Bar } from '@core/stats'
import { today } from '@core/dates'

export const KINDS: Asset['kind'][] = ['bond', 'deposit', 'stock', 'cash', 'gold', 'fx', 'fund', 'other']
export const CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP']

export function blank(kind: Asset['kind'], offer: { code: BondCode; firstRate: number; margin: number }[]): Asset {
  const id = newId()
  const d = today()
  switch (kind) {
    case 'bond': {
      const o = offer.find((x) => x.code === 'EDO')
      return { id, kind, code: 'EDO', purchase: d, count: 100, firstRate: o?.firstRate ?? 5.35, margin: o?.margin ?? 2 }
    }
    case 'deposit':
      return { id, kind, amount: 10_000, rate: 5, start: d, months: 3 }
    case 'stock':
      return { id, kind, name: '', quantity: 0, cost: 0 }
    case 'cash':
      return { id, kind, amount: 0 }
    case 'fund':
      return { id, kind, name: '', value: 0, cost: 0, equityShare: 1 }
    case 'other':
      return { id, kind, name: '', value: 0 }
    case 'gold':
      return { id, kind, grams: 31.1, cost: 0 }
    case 'fx':
      return { id, kind, currency: 'EUR', amount: 0 }
  }
}

/** Validation: returns the i18n key of the first problem, or null when the asset can be saved. */
export function invalid(a: Asset): string | null {
  const bad = (n: number | undefined, min = 0) => n === undefined || !Number.isFinite(n) || n < min
  switch (a.kind) {
    case 'bond':
      return !/^\d{4}-\d{2}-\d{2}$/.test(a.purchase) ? 'f.purchase' : bad(a.count, 1) || !Number.isInteger(a.count) ? 'f.count' : bad(a.firstRate) ? 'f.firstRate' : bad(a.margin) ? 'f.margin' : null
    case 'deposit':
      return bad(a.amount, 0.01) ? 'f.amount' : bad(a.rate) ? 'f.rate' : !/^\d{4}-\d{2}-\d{2}$/.test(a.start) ? 'f.start' : bad(a.months, 1) ? 'f.months' : null
    case 'stock':
      return !a.name.trim() ? 'f.share' : bad(a.quantity, 0.0001) ? 'f.quantity' : bad(a.cost) ? 'f.cost' : null
    case 'cash':
      return bad(a.amount) ? 'f.amount' : null
    case 'fund':
      return !a.name.trim() ? 'f.name' : bad(a.value) ? 'f.value' : bad(a.cost) ? 'f.cost' : bad(a.equityShare) ? 'f.equityShare' : null
    case 'other':
      return !a.name.trim() ? 'f.name' : bad(a.value) ? 'f.value' : null
    case 'gold':
      return bad(a.grams, 0.01) ? 'f.grams' : bad(a.cost) ? 'f.cost' : null
    case 'fx':
      return !CURRENCIES.includes(a.currency) ? 'f.currency' : bad(a.amount, 0.01) ? 'f.amount' : a.cost !== undefined && bad(a.cost) ? 'f.cost' : null
  }
}

function AssetForm({ initial, onClose }: { initial: StoredAsset; onClose: () => void }) {
  const { t, market, people } = useApp()
  const [a, setA] = useState<StoredAsset>(initial)
  const set = (p: Partial<Asset>) => setA((x) => ({ ...x, ...p }) as StoredAsset)
  const problem = invalid(a)
  const shares = market?.shares ?? []
  const save = async () => {
    if (problem) return
    await db.assets.put(a)
    onClose()
  }
  return (
    <Modal title={`${t(`kind.${a.kind}`)}`} onClose={onClose} testId="asset-form">
      <div className="grid gap-3 sm:grid-cols-2">
        {a.kind === 'bond' && (
          <>
            <Field label={t('f.code')}>
              <select
                className="input"
                value={a.code}
                onChange={(e) => {
                  const code = e.target.value as BondCode
                  const o = market?.offer.find((x) => x.code === code)
                  set({ code, firstRate: o?.firstRate ?? a.firstRate, margin: o?.margin ?? 0 })
                }}
                data-testid="f-code"
              >
                {BOND_CODES.map((c) => (
                  <option key={c} value={c}>
                    {c} – {BOND_SPECS[c].months >= 12 ? `${BOND_SPECS[c].months / 12} l.` : `${BOND_SPECS[c].months} m.`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('f.purchase')}>
              <input className="input" type="date" value={a.purchase} onChange={(e) => set({ purchase: e.target.value })} data-testid="f-purchase" />
            </Field>
            <Field label={t('f.amount')}>
              <Num value={a.count * 100} onChange={(v) => set({ count: Number.isFinite(v) ? bondsFor(v) : NaN })} testId="f-bond-amount" />
              <span className="text-xs text-stone-500">{t('f.amountHint', { count: Number.isFinite(a.count) ? a.count : 0 })}</span>
            </Field>
            <Field label={t('f.count')}>
              <Num value={a.count} onChange={(v) => set({ count: v })} testId="f-count" />
            </Field>
            <Field label={t('f.firstRate')}>
              <Num value={a.firstRate} onChange={(v) => set({ firstRate: v })} testId="f-firstRate" />
            </Field>
            <Field label={t('f.margin')}>
              <Num value={a.margin} onChange={(v) => set({ margin: v })} testId="f-margin" />
            </Field>
          </>
        )}
        {a.kind === 'deposit' && (
          <>
            <Field label={t('f.bank')}>
              <input className="input" value={a.bank ?? ''} onChange={(e) => set({ bank: e.target.value })} data-testid="f-bank" />
            </Field>
            <Field label={t('f.amount')}>
              <Num value={a.amount} onChange={(v) => set({ amount: v })} testId="f-amount" />
            </Field>
            <Field label={t('f.rate')}>
              <Num value={a.rate} onChange={(v) => set({ rate: v })} testId="f-rate" />
            </Field>
            <Field label={t('f.start')}>
              <input className="input" type="date" value={a.start} onChange={(e) => set({ start: e.target.value })} data-testid="f-start" />
            </Field>
            <Field label={t('f.months')}>
              <Num value={a.months} onChange={(v) => set({ months: v })} testId="f-months" />
            </Field>
            <Field label={t('f.renewRate')}>
              <Num value={a.renewRate} onChange={(v) => set({ renewRate: Number.isFinite(v) ? v : undefined })} testId="f-renew" />
            </Field>
          </>
        )}
        {a.kind === 'stock' && (
          <>
            <Field label={t('f.share')}>
              <input
                className="input"
                list="gpw-shares"
                value={a.name}
                placeholder={t('f.pickShare')}
                onChange={(e) => {
                  const name = e.target.value.toUpperCase()
                  const s = shares.find((x) => x.name === name)
                  set({ name, isin: s?.isin })
                }}
                data-testid="f-share"
              />
              <datalist id="gpw-shares">
                {shares.map((s) => (
                  <option key={s.isin} value={s.name}>
                    {s.type === 'etf' ? 'ETF' : ''}
                  </option>
                ))}
              </datalist>
              {a.isin && <span className="text-xs text-stone-500">ISIN {a.isin}</span>}
            </Field>
            <Field label={t('f.quantity')}>
              <Num value={a.quantity} onChange={(v) => set({ quantity: v })} testId="f-quantity" />
            </Field>
            <Field label={t('f.cost')}>
              <Num value={a.cost} onChange={(v) => set({ cost: v })} testId="f-cost" />
            </Field>
            <Field label={t('f.manualPrice')}>
              <Num value={a.manualPrice} onChange={(v) => set({ manualPrice: Number.isFinite(v) ? v : undefined })} testId="f-manual" />
            </Field>
          </>
        )}
        {(a.kind === 'cash' || a.kind === 'fund' || a.kind === 'other') && a.kind !== 'cash' && (
          <Field label={t('f.name')}>
            <input className="input" value={a.name} onChange={(e) => set({ name: e.target.value })} data-testid="f-name" />
          </Field>
        )}
        {a.kind === 'cash' && (
          <Field label={t('f.amount')}>
            <Num value={a.amount} onChange={(v) => set({ amount: v })} testId="f-amount" />
          </Field>
        )}
        {(a.kind === 'fund' || a.kind === 'other') && (
          <Field label={t('f.value')}>
            <Num value={a.value} onChange={(v) => set({ value: v })} testId="f-value" />
          </Field>
        )}
        {a.kind === 'fund' && (
          <>
            <Field label={t('f.cost')}>
              <Num value={a.cost} onChange={(v) => set({ cost: v })} testId="f-cost" />
            </Field>
            <Field label={t('f.equityShare')}>
              <Num value={a.equityShare * 100} onChange={(v) => set({ equityShare: v / 100 })} testId="f-equity" />
            </Field>
          </>
        )}
        {a.kind === 'gold' && (
          <>
            <Field label={t('f.grams')}>
              <Num value={a.grams} onChange={(v) => set({ grams: v })} testId="f-grams" />
              <span className="text-xs text-stone-500">{t('f.gramsHint')}</span>
            </Field>
            <Field label={t('f.cost')}>
              <Num value={a.cost} onChange={(v) => set({ cost: v })} testId="f-cost" />
            </Field>
          </>
        )}
        {a.kind === 'fx' && (
          <>
            <Field label={t('f.currency')}>
              <select className="input" value={a.currency} onChange={(e) => set({ currency: e.target.value })} data-testid="f-currency">
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label={t('f.amount')}>
              <Num value={a.amount} onChange={(v) => set({ amount: v })} testId="f-amount" />
            </Field>
            <Field label={t('f.costPln')}>
              <Num value={a.cost} onChange={(v) => set({ cost: Number.isFinite(v) ? v : undefined })} testId="f-cost" />
            </Field>
          </>
        )}
        {people.length > 1 && (
          <Field label={t('people.owner')}>
            <select className="input" value={a.profileId} onChange={(e) => setA((x) => ({ ...x, profileId: e.target.value }))} data-testid="f-owner">
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t('f.label')}>
          <input className="input" value={a.label ?? ''} onChange={(e) => set({ label: e.target.value || undefined })} data-testid="f-label" />
        </Field>
        {(a.kind === 'bond' || a.kind === 'stock' || a.kind === 'fund') && (
          <label className="flex items-center gap-2 self-end pb-2">
            <input type="checkbox" checked={!!a.ike} onChange={(e) => set({ ike: e.target.checked })} data-testid="f-ike" />
            {t('f.ike')}
          </label>
        )}
      </div>
      {problem && (
        <p className="mt-3 text-sm text-down" data-testid="form-problem">
          ⚠ {t(problem)}
        </p>
      )}
      <div className="mt-5 flex gap-2">
        <button type="button" className="btn-primary" disabled={!!problem} onClick={() => void save()} data-testid="f-save">
          {t('save')}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          {t('cancel')}
        </button>
      </div>
    </Modal>
  )
}

/** price history of a share / ETF (last year) with the average purchase price */
function PriceChart({ isin, avg }: { isin: string; avg: number }) {
  const { lang, t } = useApp()
  const [bars, setBars] = useState<Bar[] | null>(null)
  useEffect(() => {
    void loadSeries(`shares/${isin}`).then((b) => setBars(b.slice(-252)))
  }, [isin])
  if (!bars?.length) return null
  return (
    <div className="mt-3" data-testid="price-chart">
      <LineChart x={bars.map((b) => b.date)} height={160} lines={[{ values: bars.map((b) => b.close), color: '#0f3d3e', label: t('price') }, { values: bars.map(() => avg), color: '#c0392b', dash: '5 4', width: 1.5, label: t('chart.avgCost') }]} format={(v) => money(lang, v, 2)} />
      <p className="text-xs text-stone-500">
        <span className="text-sea">━</span> {t('price')} · <span className="text-down">╍</span> {t('chart.avgCost')}
      </p>
    </div>
  )
}

/** value of the bonds at the end of each interest period until maturity (assumed inflation for the future) */
function BondPath({ v }: { v: BondValuation }) {
  const { lang, t } = useApp()
  const capitalized = v.periods.length > 1 && v.periods[1].base !== 100
  let acc = 0
  const values = [v.nominal, ...v.periods.map((p) => (capitalized ? (p.base + p.interest) * v.count : ((acc += p.interest), (100 + acc) * v.count)))]
  if (v.periods.length < 2) return null
  return (
    <div className="mt-3" data-testid="bond-chart">
      <LineChart x={[v.periods[0].start, ...v.periods.map((p) => p.end)]} height={150} lines={[{ values, color: '#0f3d3e', label: t('value') }]} format={(x) => money(lang, x)} />
      <p className="text-xs text-stone-500">{t('chart.bondPath')}</p>
    </div>
  )
}

function Detail({ it }: { it: ValuedAsset }) {
  const { t, lang, settings } = useApp()
  const assumeCpi = settings.assumeCpi
  const a = it.asset
  if (a.kind === 'bond') {
    const v = it.detail as BondValuation
    return (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <Row k={t('bond.series')} v={v.series} />
        <Row k={t('f.count')} v={<span data-testid="bond-count">{v.count.toLocaleString(lang === 'en' ? 'en-GB' : lang === 'de' ? 'de-DE' : 'pl-PL')}</span>} />
        <Row k={t('bond.rateNow')} v={v.current ? rate(lang, v.current.rate) : '–'} />
        <Row k={t('bond.nextReset')} v={v.current ? dateFmt(lang, v.current.end) : '–'} />
        <Row k={t('bond.maturity')} v={dateFmt(lang, v.maturityDate)} />
        <Row k={t('bond.earlyFee')} v={<Money v={v.earlyFee} digits={2} />} />
        <Row k={t('bond.netIfRedeemed')} v={<Money v={v.netIfRedeemed} />} />
        <Row k={t('bond.maturityNet')} v={<Money v={v.maturityNet} />} />
        {v.assumedPeriods > 0 && <p className="col-span-full text-xs text-stone-500">{t('bond.assumed', { n: v.assumedPeriods, cpi: assumeCpi })}</p>}
        <div className="col-span-full">
          <BondPath v={v} />
        </div>
      </dl>
    )
  }
  if (a.kind === 'deposit') {
    const v = it.detail as DepositValuation
    return (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <Row k={t('dep.end')} v={dateFmt(lang, v.end)} />
        <Row k={t('dep.daysLeft')} v={String(v.daysLeft)} />
        <Row k={t('dep.endNet')} v={<Money v={v.endValueNet} digits={2} />} />
        <Row k={t('dep.break')} v={<Money v={v.breakValue} digits={2} />} />
      </dl>
    )
  }
  if (a.kind === 'stock') {
    const v = it.detail as PositionValuation
    return it.missingPrice ? (
      <p className="text-sm text-gold">{t('stock.missing')}</p>
    ) : (
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <Row k={t('price')} v={<Money v={a.quantity ? v.value / a.quantity : 0} digits={2} />} />
        <Row k={t('stock.gain')} v={<Pct v={v.gainPct} />} />
        {v.gain < 0 && <Row k={t('stock.needed')} v={<Pct v={v.neededToBreakEven} />} />}
        {a.isin && (
          <div className="col-span-full">
            <PriceChart isin={a.isin} avg={a.quantity ? a.cost / a.quantity : 0} />
          </div>
        )}
      </dl>
    )
  }
  if ((a.kind === 'gold' || a.kind === 'fx') && it.missingPrice) return <p className="text-sm text-gold">{t('stock.missing')}</p>
  return null
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-stone-500">{k}</dt>
      <dd className="font-semibold">{v}</dd>
    </div>
  )
}

export function Assets() {
  const { t, summary, market, owner, active, people } = useApp()
  const [editing, setEditing] = useState<StoredAsset | null>(null)
  const personOf = (a: Asset) => people.find((p) => p.id === (a as StoredAsset).profileId)
  const [picking, setPicking] = useState(false)
  const items = useMemo(() => [...summary.items].sort((x, y) => y.value - x.value), [summary])
  return (
    <div className="space-y-4" data-testid="assets">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-extrabold text-sea">{t('nav.assets')}</h1>
        <button type="button" className="btn-primary ml-auto" onClick={() => setPicking(true)} data-testid="add-asset">
          + {t('addAsset')}
        </button>
      </div>
      {!items.length && <p className="card text-stone-600">{t('noAssets')}</p>}
      {items.map((it) => (
        <Card
          key={it.asset.id}
          testId={`asset-${it.asset.id}`}
          title={
            <span>
              {assetName(it.asset)} <span className="text-sm font-normal text-stone-500">· {t(`kind.${it.asset.kind}`)}</span>
              {active === FAMILY && personOf(it.asset) && (
                <span className="ml-2 rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: personOf(it.asset)!.color }} data-testid="owner-badge">
                  {personOf(it.asset)!.name}
                </span>
              )}
            </span>
          }
          action={
            <div className="flex gap-1">
              <button type="button" className="btn-ghost !px-3 !py-1 text-sm" onClick={() => setEditing(it.asset as StoredAsset)} data-testid={`edit-${it.asset.id}`}>
                {t('edit')}
              </button>
              <button type="button" className="btn-ghost !px-3 !py-1 text-sm text-down" onClick={() => void db.assets.delete(it.asset.id)} data-testid={`delete-${it.asset.id}`}>
                {t('delete')}
              </button>
            </div>
          }
        >
          <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1">
            <div>
              <span className="text-xs text-stone-500">{t('value')}</span>
              <div className="text-xl font-bold">
                <Money v={it.value} testId={`value-${it.asset.id}`} />
              </div>
            </div>
            <div>
              <span className="text-xs text-stone-500">{t('cost')}</span>
              <div className="text-xl">
                <Money v={it.cost} />
              </div>
            </div>
            <div>
              <span className="text-xs text-stone-500">{t('gain')}</span>
              <div className="text-xl">
                <Money v={it.gain} sign testId={`gain-${it.asset.id}`} />
              </div>
            </div>
          </div>
          <Detail it={it} />
        </Card>
      ))}
      {picking && (
        <Modal title={t('addAsset')} onClose={() => setPicking(false)} testId="kind-picker">
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className="btn-ghost !justify-start !py-4 text-left"
                onClick={() => {
                  setPicking(false)
                  setEditing({ ...blank(k, market?.offer ?? []), profileId: owner } as StoredAsset)
                }}
                data-testid={`kind-${k}`}
              >
                {t(`kind.${k}`)}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {editing && <AssetForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
