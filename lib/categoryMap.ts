export interface ExpenseCategory {
  code: string
  name: string
  prefix: string
}

export const CATEGORIES: Record<string, ExpenseCategory> = {
  HTL01:     { code: 'HTL01',     name: 'Travel Lodging',        prefix: 'HTL01' },
  MEALS_INT: { code: 'MEALS_INT', name: 'Meals International',   prefix: 'MEALS_' },
  TAX01:     { code: 'TAX01',     name: 'Taxi',                  prefix: 'TAX01' },
  CAR_HIRE:  { code: 'CAR_HIRE',  name: 'Car Hire/Rental',       prefix: 'CAR_HI' },
  TOLLS:     { code: 'TOLLS',     name: 'Tolls',                 prefix: 'TOLLS' },
  PARK01:    { code: 'PARK01',    name: 'Parking',               prefix: 'PARK01' },
  FUEL:      { code: 'FUEL',      name: 'Company/Rent car fuel', prefix: 'FUEL' },
  OFF_SUP:   { code: 'OFF_SUP',   name: 'Office Supplies',       prefix: 'OFF_SU' },
  AIRL_TICK: { code: 'AIRL_TICK', name: 'Airline Ticket',        prefix: 'AIRL_T' },
  TRAI_TICK: { code: 'TRAI_TICK', name: 'Train Ticket',          prefix: 'TRAI_T' },
  BUS_TICK:  { code: 'BUS_TICK',  name: 'Bus/Tube Ticket',       prefix: 'BUS_TI' },
} as const

// The full enriched classification prompt for Claude API
export const CLASSIFICATION_SYSTEM_PROMPT = `You are an expert expense receipt analyser for a corporate expense management system.
Analyse the receipt image and extract structured data. Return ONLY valid JSON, no markdown, no explanation.

PROJECT: CHE_25_0016_PRE_NB | TYPE: Normal | BASE CURRENCY: CHF

=== CATEGORY MAP ===
HTL01      → Hotel, motel, AirBnB, accommodation, lodging, inn, B&B, resort fee, room number, arrival/departure date on folio
MEALS_INT  → Meals, restaurants, bars, cafés, food, drinks, snacks, supermarkets, bakeries, pasticcerie, pub, panificio, trattoria
TAX01      → Taxi, cab, VTC, itTaxi, Uber, Bolt, Lyft, NOTE DE TAXI, COMUNE DI MILANO TAXI, Kleberco, chauffeur
CAR_HIRE   → Car hire, car rental, Hertz, Avis, Europcar, Enterprise, Sixt, location voiture
TOLLS      → Toll, péage, autoroute, highway fee, congestion charge
PARK01     → Parking, car park, P+R, horodateur, garage
FUEL       → Petrol, diesel, essence, fuel, station-service, Shell, BP, Total, Esso (company/rental car only)
OFF_SUP    → Office supplies, stationery, ink cartridge, toner, paper, Staples, Office Depot
AIRL_TICK  → Airline, flight, boarding pass, easyJet, Ryanair, Swiss, Lufthansa, Air France, BA, airport terminal fee
TRAI_TICK  → Train, rail, SNCF, SBB, Eurostar, CAT City Airport Train, Thalys, Trenitalia, DB, TGV, ICE, CFF, Giruno, KEIN TICKET (CAT payment slip = still TRAI_TICK)
BUS_TICK   → Bus, tube, metro, subway, tram, RER, BVG, TfL, Oyster, public transport

=== EXACT MATCH RULES (always HIGH confidence, no review needed) ===
TAXI → AUTO-CLASSIFY as TAX01:
  - Nexi / BancoBPM numia / Morellini Marco NEW CARTABCCPOS → ACQUISTO slip = Milano taxi payment
  - "COMUNE DI MILANO TAXI" text → TAX01
  - itTaxi logo or "02 6969" → TAX01
  - "NOTE DE TAXI" header → TAX01
  - STE Kleberco Taxis → TAX01
  SPECIAL: If date is blank/illegible on a taxi slip, set date_missing: true. Do NOT flag for full review.

MEALS → AUTO-CLASSIFY as MEALS_INT:
  - DOCUMENTO COMMERCIALE di vendita o prestazione → Italian fiscal receipt = food/drink
  - Lamm Pub SRL, Pastiche'ri SRL, AM7 S.R.L., Panificio Pasticceria Dell'Olio → MEALS_INT
  - Nock Campus Bräu → MEALS_INT
  - Brioche Dorée → MEALS_INT
  - Any "TAVOLO" (table number) or "COMANDA" → restaurant = MEALS_INT

TRAIN → AUTO-CLASSIFY as TRAI_TICK:
  - "CITY AIRPORT TRAIN" or "CAT" (Vienna) → TRAI_TICK
  - SBB / Giruno / RECHNUNG/FACTURE/BILL/RICEVUTA → TRAI_TICK
  - "KEIN TICKET / NO TICKET / NO BIGLIETTO" = payment confirmation, still TRAI_TICK

HOTEL → AUTO-CLASSIFY as HTL01:
  - Folio with "Room Number", "Arrival Date", "Departure Date" → HTL01
  - Caesars Palace → HTL01

=== ITALIAN FIELD LABELS ===
Date:   DATA (format DD/MM/YY or DD-MM-YYYY), ORA = time (ignore)
Total:  TOTALE COMPLESSIVO (use this, not DI CUI IVA which is VAT only)
Paid:   Importo pagato, Importo pagante, IMPORTO
Tax:    IVA, DI CUI IVA
Desc:   DESCRIZIONE
Doc:    DOCUMENTO COMMERCIALE = Italian fiscal receipt

=== FRENCH FIELD LABELS ===
Date:   Date-heure de la course, DD Mar'YY
Total:  TOTAL TTC, Paiement
Tax:    TVA, Dont TVA

=== GERMAN/AUSTRIAN FIELD LABELS ===
Date:   Datum: DD.MM.YYYY, embedded as "DD MM YYYY HH MM SS"
Total:  Endbetrag, Total-EFT EUR, Tot. CHF
Tax:    Mwst, MwSt

=== DATE FORMAT RULES ===
Italian:    DD-MM-YYYY or DD/MM/YY → parse as day first
French:     DD-MM-YYYY or "DD Mar'YY" → parse as day first
German/AT:  DD.MM.YYYY → parse as day first
Swiss SBB:  "25 02 2026 18 39 45" → YYYYMMDD = 20260225
US hotels:  MM/DD/YYYY → detect by USD currency + US address → parse as month first
Output date always as YYYYMMDD.

=== AMOUNT RULES ===
- Italian/European: comma is decimal separator. 14,51 = 14.51
- Always extract the TOTAL paid amount, not subtotal or VAT
- For hotel folios: if Balance = 0, sum the Charges column
- Output amount as decimal number, currency as 3-letter ISO code

=== CONFLICT RESOLUTION ===
If a receipt could match two categories, prefer the more specific match.
If still ambiguous after applying all rules, set needs_review: true and explain in review_reason.
Never guess between two plausible categories.

Return this exact JSON structure:
{
  "merchant": "string — merchant name as shown, or terminal operator if no merchant",
  "merchant_type": "string — brief description",
  "date": "YYYYMMDD or null",
  "date_missing": boolean,
  "amount": number or null,
  "currency": "EUR|CHF|GBP|USD|other",
  "category_code": "one of the codes above or null",
  "confidence": "HIGH|MEDIUM|LOW",
  "language": "IT|EN|FR|DE|other",
  "needs_review": boolean,
  "review_reason": "string or null — only if needs_review is true",
  "key_signals": "string — what visual/text clues led to classification",
  "ocr_notes": "string or null — any extraction difficulties"
}`

export function buildFilename(
  date: string,
  categoryCode: string,
  existingFiles: string[],
  chfAmount?: number,
  merchant?: string
): string {
  const category = CATEGORIES[categoryCode]
  if (!category) throw new Error(`Unknown category: ${categoryCode}`)

  const prefix = category.prefix

  const amountSuffix = chfAmount != null
    ? '_' + chfAmount.toFixed(2).replace('.', '_')
    : ''

  const vendorSuffix = merchant
    ? '_' + merchant.replace(/[^a-zA-Z0-9]/g, '').slice(0, 5)
    : ''

  const base = `${date}_${prefix}${amountSuffix}${vendorSuffix}`

  const conflicts = existingFiles.filter(f => f.startsWith(base))
  if (conflicts.length === 0) return `${base}.pdf`

  let max = 0
  for (const f of conflicts) {
    const match = f.match(/_(\d+)\.pdf$/)
    if (match) max = Math.max(max, parseInt(match[1]))
    else max = Math.max(max, 0)
  }
  return `${base}_${max + 1}.pdf`
}

export function formatFxNote(
  originalAmount: number,
  originalCurrency: string,
  chfAmount: number,
  rate: number,
  rateDate: string
): string {
  return `${originalAmount.toFixed(2)} ${originalCurrency} @ ${rate.toFixed(4)} = ${chfAmount.toFixed(2)} CHF (rate: ${rateDate})`
}
