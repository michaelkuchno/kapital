# Data sources and rules (checked 2026-11-20)

All sources are official, free and need no API key. The fetcher identifies itself with the user agent `kapital-data/1.0` and sends one request at a time, with pauses.

| Data | Endpoint | Notes |
|---|---|---|
| GPW daily quotes (shares, indices) | `https://www.gpw.pl/archiwum-notowan?fetch=1&type=10\|1&instrument=&date=DD-MM-YYYY` | Old BIFF `.xls` file. On non-trading days the response is the HTML form, which is detected by the magic bytes. Index names: `WIG-ENERG` (not ENERGIA), `MWIG40`, `SWIG80`. There is no telecom index any more. |
| CPI y/y (GUS DBW API) | `https://api-dbw.stat.gov.pl/api/1.1.0/variable/variable-data-section?id-zmienna=305&id-przekroj=…&id-rok=…&id-okres=246+month` | Section 736 (COICOP 1999) up to 2025, 1698 (COICOP 2018) from 2026; from 2026 the total is on the last page. Filters: Polska 33617, households 6902025, measure 5 (same month a year earlier = 100). Anonymous limit: 100 requests per 15 min. License CC BY 4.0. |
| NBP reference rate | `https://static.nbp.pl/dane/stopy/stopy_procentowe.xml` (+ `_archiwum.xml`) | UTF-8 with a BOM, decimal comma. |
| FX, gold | `https://api.nbp.pl/api/exchangerates/tables/a/`, `/api/cenyzlota/last/60` | JSON. |
| Retail bond offer | `https://www.obligacjeskarbowe.pl/oferta-obligacji/<slug>/` (redirects to the current series) | Fields `product-details__list-label/value`: Seria, Oprocentowanie. |

## Treasury bond rules used in `src/core/bonds.ts`
- **Index:** in periods 2 and later the rate is CPI y/y "ogłaszany przez Prezesa GUS w miesiącu poprzedzającym pierwszy miesiąc danego okresu odsetkowego", i.e. the reading for the month two months before the period starts. Negative values are taken as 0 (*"w przypadku ujemnej stopy inflacji … brana jest wartość zerowa"*).
- **EDO:** the interest base is 100 zł plus the interest of earlier years (annual capitalization).
- **Early redemption fee per bond:**

  | Bond | Bought before 1 Sep 2024 | Bought from 1 Sep 2024 |
  |---|---|---|
  | ROR | 0.50 | 0.50 |
  | DOR | 0.70 | 0.70 |
  | TOS | 0.70 | 1.00 |
  | COI | 0.70 | 2.00 |
  | EDO | 2.00 | 3.00 |
  | ROS | 0.70 | 2.00 |
  | ROD | 2.00 | 3.00 |

  - OTS: the paid-in amount is returned without interest.
  - Capitalized bonds: the fee is capped at the accrued interest.
  - COI (and ROR/DOR): the fee is capped only in the first period.
- **Tax:** 19 % (art. 30a PIT) on interest minus the fee. Withheld tax is rounded to grosze (Ordynacja podatkowa art. 63 § 1a). For PIT-38, the base and the tax are rounded to full złoty.

## Research behind the insights
See `src/core/evidence.ts`. Every insight in the app links to:
- Markowitz 1952; Bessembinder 2018
- Shefrin & Statman 1985; Odean 1998; Barber & Odean 2000
- Jegadeesh & Titman 1993; Moskowitz, Ooi & Pedersen 2012; Moskowitz & Grinblatt 1999; Faber 2007
- Sharpe 1991; French & Poterba 1991
- Jaconetti et al. 2010 (Vanguard); Lusardi et al. 2011
- the Dimson–Marsh–Staunton yearbook; Fisher 1930
- the PIT and IKE/IKZE acts

## IKE / IKZE limits 2026
- IKE: 28 260 zł
- IKZE: 11 304 zł

Source: MRPiPS announcement; the limits are 3× and 1.2× the forecast average wage of 9 420 zł.
