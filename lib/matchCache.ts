// Merchant match cache using localStorage
// Key: normalized merchant name → { category, hits, lastSeen }

export interface CacheEntry {
  category: string
  hits: number
  lastSeen: string // ISO date
  source: 'auto' | 'manual' // auto = Claude classified, manual = user corrected
}

export interface MatchCache {
  [merchant: string]: CacheEntry
}

const CACHE_KEY = 'ocr_expense_cache_v1'

export function normalizeMerchant(merchant: string): string {
  return merchant
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]/g, '')
    .replace(/\b(srl|spa|s\.r\.l\.|s\.p\.a\.|unipersonale|gmbh|ag|ltd|inc)\b/gi, '')
    .trim()
}

export function loadCache(): MatchCache {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveCache(cache: MatchCache): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // localStorage full or unavailable — fail silently
  }
}

export function lookupCache(
  cache: MatchCache,
  merchant: string
): CacheEntry | null {
  const key = normalizeMerchant(merchant)
  // Exact match
  if (cache[key]) return cache[key]
  // Partial match — merchant contains a known key or vice versa
  for (const [k, entry] of Object.entries(cache)) {
    if (k.length >= 4 && (key.includes(k) || k.includes(key))) {
      return entry
    }
  }
  return null
}

export function recordMatch(
  cache: MatchCache,
  merchant: string,
  category: string,
  source: 'auto' | 'manual'
): MatchCache {
  const key = normalizeMerchant(merchant)
  if (!key) return cache
  const existing = cache[key]
  const updated: MatchCache = {
    ...cache,
    [key]: {
      category,
      hits: (existing?.hits || 0) + 1,
      lastSeen: new Date().toISOString().split('T')[0],
      source,
    }
  }
  saveCache(updated)
  return updated
}

export function getCacheStats(cache: MatchCache) {
  const entries = Object.entries(cache)
  const totalHits = entries.reduce((sum, [, e]) => sum + e.hits, 0)
  return {
    merchants: entries.length,
    totalHits,
    topMerchants: entries
      .sort((a, b) => b[1].hits - a[1].hits)
      .slice(0, 5)
      .map(([k, e]) => ({ merchant: k, category: e.category, hits: e.hits }))
  }
}
