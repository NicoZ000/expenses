export interface FxRates {
  fetchedAt: string
  fetchedDate: string
  rates: Record<string, number> // currency -> CHF rate (1 unit = X CHF)
}

const SESSION_KEY = 'fx_rates_session'

// Server-side in-memory cache (persists for process lifetime)
let serverCache: FxRates | null = null

export async function fetchRates(): Promise<FxRates> {
  // Return cached if available
  if (serverCache) return serverCache

  const currencies = ['EUR', 'USD', 'GBP', 'JPY', 'CAD', 'AUD']
  const rates: Record<string, number> = { CHF: 1 }

  // Use exchangerate-api (free tier, no key needed for basic)
  // Fallback to hardcoded approximate rates if fetch fails
  try {
    const response = await fetch(
      'https://api.exchangerate-api.com/v4/latest/CHF',
      { next: { revalidate: 3600 } }
    )
    if (response.ok) {
      const data = await response.json()
      // data.rates gives X per CHF, we want CHF per X
      for (const currency of currencies) {
        if (data.rates[currency]) {
          rates[currency] = 1 / data.rates[currency]
        }
      }
    }
  } catch {
    // Fallback approximate rates
    rates['EUR'] = 0.942
    rates['USD'] = 0.891
    rates['GBP'] = 1.123
    rates['JPY'] = 0.006
    rates['CAD'] = 0.656
    rates['AUD'] = 0.571
  }

  const now = new Date()
  const fetchedDate = now.toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  })

  serverCache = {
    fetchedAt: now.toISOString(),
    fetchedDate,
    rates
  }

  return serverCache
}

export function convertToChf(amount: number, currency: string, rates: FxRates): number {
  if (currency === 'CHF') return amount
  const rate = rates.rates[currency]
  if (!rate) return amount // unknown currency, return as-is
  return amount * rate
}

export function getRateDisplay(rates: FxRates): string {
  const parts = Object.entries(rates.rates)
    .filter(([c]) => c !== 'CHF')
    .map(([c, r]) => `1 ${c} = ${r.toFixed(4)} CHF`)
  return `Rates loaded ${rates.fetchedDate}: ${parts.join(' · ')}`
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
