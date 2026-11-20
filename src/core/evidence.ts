/** Research and legal sources behind every insight (shown in the app under "Why?"). */
export interface Evidence {
  id: string
  cite: string
  url: string
}

export const EVIDENCE: Record<string, Evidence> = {
  markowitz1952: { id: 'markowitz1952', cite: 'Markowitz, H. (1952). Portfolio Selection. Journal of Finance, 7(1), 77–91.', url: 'https://doi.org/10.1111/j.1540-6261.1952.tb01525.x' },
  bessembinder2018: { id: 'bessembinder2018', cite: 'Bessembinder, H. (2018). Do stocks outperform Treasury bills? Journal of Financial Economics, 129(3), 440–457.', url: 'https://doi.org/10.1016/j.jfineco.2018.06.004' },
  shefrin1985: { id: 'shefrin1985', cite: 'Shefrin, H., Statman, M. (1985). The Disposition to Sell Winners Too Early and Ride Losers Too Long. Journal of Finance, 40(3), 777–790.', url: 'https://doi.org/10.1111/j.1540-6261.1985.tb05002.x' },
  odean1998: { id: 'odean1998', cite: 'Odean, T. (1998). Are Investors Reluctant to Realize Their Losses? Journal of Finance, 53(5), 1775–1798.', url: 'https://doi.org/10.1111/0022-1082.00072' },
  barber2000: { id: 'barber2000', cite: 'Barber, B., Odean, T. (2000). Trading Is Hazardous to Your Wealth. Journal of Finance, 55(2), 773–806.', url: 'https://doi.org/10.1111/0022-1082.00226' },
  jegadeesh1993: { id: 'jegadeesh1993', cite: 'Jegadeesh, N., Titman, S. (1993). Returns to Buying Winners and Selling Losers. Journal of Finance, 48(1), 65–91.', url: 'https://doi.org/10.1111/j.1540-6261.1993.tb04702.x' },
  moskowitz2012: { id: 'moskowitz2012', cite: 'Moskowitz, T., Ooi, Y. H., Pedersen, L. H. (2012). Time series momentum. Journal of Financial Economics, 104(2), 228–250.', url: 'https://doi.org/10.1016/j.jfineco.2011.11.003' },
  moskowitz1999: { id: 'moskowitz1999', cite: 'Moskowitz, T., Grinblatt, M. (1999). Do Industries Explain Momentum? Journal of Finance, 54(4), 1249–1290.', url: 'https://doi.org/10.1111/0022-1082.00146' },
  faber2007: { id: 'faber2007', cite: 'Faber, M. (2007). A Quantitative Approach to Tactical Asset Allocation. Journal of Wealth Management, 9(4), 69–79.', url: 'https://doi.org/10.3905/jwm.2007.674809' },
  sharpe1991: { id: 'sharpe1991', cite: 'Sharpe, W. F. (1991). The Arithmetic of Active Management. Financial Analysts Journal, 47(1), 7–9.', url: 'https://doi.org/10.2469/faj.v47.n1.7' },
  french1991: { id: 'french1991', cite: 'French, K., Poterba, J. (1991). Investor Diversification and International Equity Markets. American Economic Review, 81(2), 222–226.', url: 'https://www.jstor.org/stable/2006858' },
  jaconetti2010: { id: 'jaconetti2010', cite: 'Jaconetti, C., Kinniry, F., Zilbering, Y. (2010). Best practices for portfolio rebalancing. Vanguard Research.', url: 'https://corporate.vanguard.com/content/dam/corp/research/pdf/Best-practices-for-portfolio-rebalancing-ISGPORE.pdf' },
  lusardi2011: { id: 'lusardi2011', cite: 'Lusardi, A., Schneider, D., Tufano, P. (2011). Financially Fragile Households. Brookings Papers on Economic Activity, Spring 2011, 83–134.', url: 'https://doi.org/10.1353/eca.2011.0002' },
  dms: { id: 'dms', cite: 'Dimson, E., Marsh, P., Staunton, M. Global Investment Returns Yearbook (UBS, annual) – long-run real returns of equities, bonds and bills.', url: 'https://www.ubs.com/global/en/investment-bank/insights-and-data/global-investment-returns-yearbook.html' },
  fisher1930: { id: 'fisher1930', cite: 'Fisher, I. (1930). The Theory of Interest – real vs nominal interest rate.', url: 'https://oll.libertyfund.org/titles/fisher-the-theory-of-interest' },
  bonds: { id: 'bonds', cite: 'Ministerstwo Finansów – obligacje skarbowe detaliczne: oferta, listy emisyjne, zasady wcześniejszego wykupu.', url: 'https://www.obligacjeskarbowe.pl/' },
  pit: { id: 'pit', cite: 'Ustawa o podatku dochodowym od osób fizycznych: art. 30a (19 % od odsetek), art. 30b (zbycie papierów wartościowych, PIT-38), art. 9 ust. 3 (rozliczanie strat).', url: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350' },
  ike: { id: 'ike', cite: 'Ustawa z 20 kwietnia 2004 r. o indywidualnych kontach emerytalnych oraz indywidualnych kontach zabezpieczenia emerytalnego.', url: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20041160205' },
  gus: { id: 'gus', cite: 'GUS – wskaźniki cen towarów i usług konsumpcyjnych (inflacja).', url: 'https://stat.gov.pl/' },
  nbp: { id: 'nbp', cite: 'NBP – stopy procentowe, kursy walut, ceny złota.', url: 'https://nbp.pl/' },
  gpw: { id: 'gpw', cite: 'Giełda Papierów Wartościowych w Warszawie – archiwum notowań, indeksy sektorowe (GPW Benchmark).', url: 'https://www.gpw.pl/archiwum-notowan' },
}
