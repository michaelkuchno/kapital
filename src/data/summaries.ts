import { analyzeTrend, rankSectors, type TrendReport } from '../core/trends'
import type { Bar } from '../core/stats'
import { SECTORS } from './parse'

export interface IndexSummary {
  code: string
  report: TrendReport
  rank?: number
}

/** Trend reports for all indices; sectors are ranked against each other and measured against the WIG. */
export function summarizeIndices(series: ReadonlyMap<string, readonly Bar[]>): { indices: IndexSummary[]; sectors: IndexSummary[] } {
  const wig = series.get('WIG')
  const indices: IndexSummary[] = []
  for (const [code, s] of series) if (s.length) indices.push({ code, report: analyzeTrend(s, code === 'WIG' ? undefined : wig) })
  const ranked = rankSectors(indices.filter((x) => (SECTORS as readonly string[]).includes(x.code)))
  return { indices: indices.sort((a, b) => a.code.localeCompare(b.code)), sectors: ranked }
}

/** Human-friendly sector names (all three languages). */
export const SECTOR_NAMES: Record<string, { pl: string; en: string; de: string }> = {
  'WIG-BANKI': { pl: 'Banki', en: 'Banks', de: 'Banken' },
  'WIG-BUDOW': { pl: 'Budownictwo', en: 'Construction', de: 'Bau' },
  'WIG-CHEMIA': { pl: 'Chemia', en: 'Chemicals', de: 'Chemie' },
  'WIG-ENERG': { pl: 'Energetyka', en: 'Energy (utilities)', de: 'Energieversorger' },
  'WIG-GORNIC': { pl: 'Górnictwo', en: 'Mining', de: 'Bergbau' },
  'WIG-GRY': { pl: 'Gry komputerowe', en: 'Video games', de: 'Videospiele' },
  'WIG-INFO': { pl: 'Informatyka', en: 'IT', de: 'IT' },
  'WIG-LEKI': { pl: 'Leki i ochrona zdrowia', en: 'Pharma & health', de: 'Pharma & Gesundheit' },
  'WIG-MEDIA': { pl: 'Media', en: 'Media', de: 'Medien' },
  'WIG-MOTO': { pl: 'Motoryzacja', en: 'Automotive', de: 'Automobil' },
  'WIG-NRCHOM': { pl: 'Nieruchomości', en: 'Real estate', de: 'Immobilien' },
  'WIG-ODZIEZ': { pl: 'Odzież', en: 'Clothing', de: 'Bekleidung' },
  'WIG-PALIWA': { pl: 'Paliwa', en: 'Oil & gas', de: 'Öl & Gas' },
  'WIG-SPOZYW': { pl: 'Spożywczy', en: 'Food', de: 'Lebensmittel' },
  WIG: { pl: 'Cała giełda (WIG)', en: 'Whole market (WIG)', de: 'Gesamtmarkt (WIG)' },
  WIG20: { pl: '20 największych (WIG20)', en: 'Top 20 (WIG20)', de: 'Top 20 (WIG20)' },
  MWIG40: { pl: 'Średnie spółki (mWIG40)', en: 'Mid caps (mWIG40)', de: 'Mid Caps (mWIG40)' },
  SWIG80: { pl: 'Małe spółki (sWIG80)', en: 'Small caps (sWIG80)', de: 'Small Caps (sWIG80)' },
  WIG20TR: { pl: 'WIG20 z dywidendami (WIG20TR)', en: 'WIG20 with dividends (WIG20TR)', de: 'WIG20 mit Dividenden (WIG20TR)' },
  MWIG40TR: { pl: 'mWIG40 z dywidendami (mWIG40TR)', en: 'mWIG40 with dividends (mWIG40TR)', de: 'mWIG40 mit Dividenden (mWIG40TR)' },
  'TBSP.INDEX': { pl: 'Obligacje skarbowe (TBSP)', en: 'Treasury bonds (TBSP)', de: 'Staatsanleihen (TBSP)' },
}
