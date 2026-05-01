'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { CATEGORIES, buildFilename } from '@/lib/categoryMap'
import {
  loadCache, recordMatch, lookupCache, getCacheStats,
  type MatchCache, type CacheEntry
} from '@/lib/matchCache'

interface ExtractedExpense {
  id: string
  file: File
  fileName: string
  status: 'pending' | 'processing' | 'review' | 'done' | 'error'
  merchant?: string
  date?: string
  date_missing?: boolean
  amount?: number
  currency?: string
  chfAmount?: number
  fxNote?: string
  category_code?: string
  confidence?: string
  language?: string
  needs_review?: boolean
  review_reason?: string
  key_signals?: string
  ocr_notes?: string
  resolvedDate?: string
  resolvedCategory?: string
  finalFilename?: string
  error?: string
  fromCache?: boolean  // true = skipped API call
}

interface RatesInfo { display: string; fetchedDate: string }

const CATEGORY_LIST = Object.values(CATEGORIES)

function buildManifest(exps: ExtractedExpense[]): string {
  const manifest = exps.map(exp => {
    const category = exp.resolvedCategory ? CATEGORIES[exp.resolvedCategory] : null
    return {
      filename: exp.finalFilename,
      date: exp.resolvedDate,
      category_code: exp.resolvedCategory,
      category_label: category ? `${category.name} (${category.code})` : exp.resolvedCategory,
      amount_chf: exp.chfAmount ? parseFloat(exp.chfAmount.toFixed(2)) : null,
      amount_original: exp.amount ? parseFloat(exp.amount.toFixed(2)) : null,
      currency_original: exp.currency,
      notes: exp.fxNote
        ? `${exp.merchant || ''} — ${exp.fxNote}`.trim()
        : (exp.merchant || ''),
      merchant: exp.merchant,
    }
  })
  return JSON.stringify(manifest, null, 2)
}

function downloadFile(exp: ExtractedExpense) {
  if (!exp.finalFilename || !exp.file) return
  const url = URL.createObjectURL(exp.file)
  const a = document.createElement('a')
  a.href = url
  a.download = exp.finalFilename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function downloadAll(exps: ExtractedExpense[]) {
  exps.forEach((exp, i) => setTimeout(() => downloadFile(exp), i * 300))
}

export default function Home() {
  const [expenses, setExpenses] = useState<ExtractedExpense[]>([])
  const [rates, setRates] = useState<RatesInfo | null>(null)
  const [processing, setProcessing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [showCache, setShowCache] = useState(false)
  const [manifestCopied, setManifestCopied] = useState(false)

  const copyManifest = async () => {
    const json = buildManifest(done)
    await navigator.clipboard.writeText(json)
    setManifestCopied(true)
    setTimeout(() => setManifestCopied(false), 3000)
  }
  const [cache, setCache] = useState<MatchCache>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const processedFilenamesRef = useRef<string[]>([])

  useEffect(() => {
    setCache(loadCache())
  }, [])

  const updateCache = (merchant: string, category: string, source: 'auto' | 'manual') => {
    if (!merchant) return
    setCache(prev => recordMatch(prev, merchant, category, source))
  }

  const ensureRates = async () => {
    if (rates) return
    const r = await fetch('/api/rates').then(res => res.json())
    setRates({ display: r.display, fetchedDate: r.fetchedDate })
  }

  const processFile = async (expense: ExtractedExpense) => {
    setExpenses(prev => prev.map(e => e.id === expense.id ? { ...e, status: 'processing' } : e))
    try {
      const formData = new FormData()
      formData.append('file', expense.file)

      // Always call API for OCR (date + amount extraction),
      // but pass cache hint so API can skip classification if we have it
      const cacheHint = expense.merchant ? lookupCache(cache, expense.merchant) : null

      const res = await fetch('/api/ocr', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      // Check cache after we have the merchant name from OCR
      const cachedMatch = data.merchant ? lookupCache(cache, data.merchant) : null
      let fromCache = false

      if (cachedMatch && cachedMatch.hits >= 1 && data.date && !data.date_missing) {
        // Cache hit — override category, skip review
        data.category_code = cachedMatch.category
        data.confidence = 'HIGH'
        data.needs_review = false
        fromCache = true
      }

      const needsFullReview = data.needs_review && !data.date_missing
      const needsDateOnly = data.date_missing

      let finalFilename: string | undefined
      if (!needsFullReview && !needsDateOnly && data.date && data.category_code) {
        finalFilename = buildFilename(data.date, data.category_code, processedFilenamesRef.current)
        processedFilenamesRef.current.push(finalFilename)
        // Save to cache
        if (data.merchant) updateCache(data.merchant, data.category_code, 'auto')
      }

      setExpenses(prev => prev.map(e => e.id === expense.id ? {
        ...e, ...data,
        status: (needsFullReview || needsDateOnly) ? 'review' : 'done',
        resolvedDate: data.date,
        resolvedCategory: data.category_code,
        finalFilename,
        fromCache,
      } : e))

      if (needsFullReview || needsDateOnly) setReviewingId(expense.id)
    } catch (err) {
      setExpenses(prev => prev.map(e => e.id === expense.id ? { ...e, status: 'error', error: String(err) } : e))
    }
  }

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    await ensureRates()
    const newExpenses: ExtractedExpense[] = Array.from(files)
      .filter(f => f.type === 'application/pdf')
      .map(f => ({ id: crypto.randomUUID(), file: f, fileName: f.name, status: 'pending' as const }))
    if (!newExpenses.length) return
    setExpenses(prev => [...prev, ...newExpenses])
    setProcessing(true)
    for (const expense of newExpenses) await processFile(expense)
    setProcessing(false)
  }, [rates, cache])

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files)
  }

  const confirmReview = (id: string, date: string, category: string) => {
    setExpenses(prev => prev.map(e => {
      if (e.id !== id) return e
      const filename = buildFilename(date, category, processedFilenamesRef.current)
      processedFilenamesRef.current.push(filename)
      // Manual correction — save to cache with higher weight
      if (e.merchant) updateCache(e.merchant, category, 'manual')
      return { ...e, resolvedDate: date, resolvedCategory: category, finalFilename: filename, status: 'done' }
    }))
    setReviewingId(null)
  }

  const done = expenses.filter(e => e.status === 'done')
  const pending = expenses.filter(e => ['pending','processing'].includes(e.status))
  const review = expenses.filter(e => e.status === 'review')
  const cacheStats = getCacheStats(cache)
  const cachedCount = expenses.filter(e => e.fromCache).length

  return (
    <div className="min-h-screen bg-[#f8f8f6]">
      <header className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-gray-900 tracking-tight">OCR_Rename_Exp</h1>
            <p className="text-xs text-gray-400 mt-0.5">CHE_25_0016_PRE_NB · Normal · output: CHF</p>
          </div>
          <div className="flex items-center gap-3">
            {rates && (
              <p className="text-xs text-gray-400 hidden md:block max-w-xs text-right leading-relaxed">{rates.display}</p>
            )}
            <button
              onClick={() => setShowCache(true)}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors"
            >
              Cache · {cacheStats.merchants}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">

        {/* Drop Zone */}
        <div
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all mb-8 select-none ${
            dragOver ? 'border-blue-400 bg-blue-50/60' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <div className="text-2xl mb-2">📂</div>
          <p className="text-sm font-medium text-gray-700">Drop PDF receipts here</p>
          <p className="text-xs text-gray-400 mt-1">Multiple files supported · IT / EN / FR / DE</p>
          <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden"
            onChange={e => e.target.files && handleFiles(e.target.files)} />
        </div>

        {/* Review Modal */}
        {reviewingId && (() => {
          const exp = expenses.find(e => e.id === reviewingId)
          if (!exp) return null
          return (
            <ReviewCard
              expense={exp}
              dateOnly={!!exp.date_missing && !exp.needs_review}
              onConfirm={(d, c) => confirmReview(exp.id, d, c)}
              onSkip={() => setReviewingId(null)}
            />
          )
        })()}

        {/* Cache panel */}
        {showCache && (
          <CachePanel
            cache={cache}
            stats={cacheStats}
            onClose={() => setShowCache(false)}
            onClear={() => {
              localStorage.removeItem('ocr_expense_cache_v1')
              setCache({})
              setShowCache(false)
            }}
            onRemove={(key) => {
              const updated = { ...cache }
              delete updated[key]
              setCache(updated)
              localStorage.setItem('ocr_expense_cache_v1', JSON.stringify(updated))
            }}
          />
        )}

        {/* Stats */}
        {expenses.length > 0 && (
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Total', n: expenses.length, cls: 'text-gray-900' },
              { label: 'Done', n: done.length, cls: 'text-green-700' },
              { label: 'Review', n: review.length, cls: 'text-amber-700' },
              { label: 'Processing', n: pending.length, cls: 'text-blue-700' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className={`text-2xl font-semibold tabular-nums ${s.cls}`}>{s.n}</div>
                <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Cache hit banner */}
        {cachedCount > 0 && (
          <div className="mb-4 text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-xl px-4 py-2.5">
            {cachedCount} receipt{cachedCount !== 1 ? 's' : ''} classified instantly from cache — no API call needed
          </div>
        )}

        {/* Expense Rows */}
        <div className="space-y-2">
          {expenses.map(exp => (
            <ExpenseRow
              key={exp.id}
              expense={exp}
              onReview={() => setReviewingId(exp.id)}
              onDownload={() => downloadFile(exp)}
            />
          ))}
        </div>

        {/* Summary + Download */}
        {done.length > 0 && !processing && review.length === 0 && (
          <div className="mt-8 bg-white border border-gray-200 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-900">
                {done.length} expense{done.length !== 1 ? 's' : ''} ready
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded-full">Phase 1 complete</span>
                <button
                  onClick={() => downloadAll(done)}
                  className="text-xs px-4 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
                >
                  Download all ({done.length})
                </button>
              </div>
            </div>
            <div className="space-y-2 mb-5">
              {done.map(exp => (
                <div key={exp.id} className="flex items-start justify-between text-xs py-2.5 border-b border-gray-100 last:border-0 gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <button onClick={() => downloadFile(exp)}
                        className="font-mono text-blue-700 hover:text-blue-900 font-medium text-left underline underline-offset-2">
                        {exp.finalFilename}
                      </button>
                      {exp.fromCache && (
                        <span className="text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded text-xs">cached</span>
                      )}
                    </div>
                    <div className="text-gray-400 mt-0.5 truncate">← {exp.fileName}</div>
                    {exp.fxNote && <div className="text-gray-400 mt-0.5 font-mono">{exp.fxNote}</div>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-semibold text-gray-900">{exp.chfAmount?.toFixed(2)} CHF</div>
                    {exp.currency !== 'CHF' && exp.amount != null && (
                      <div className="text-gray-400">{exp.amount.toFixed(2)} {exp.currency}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 pt-4 mt-2">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs font-medium text-gray-700">Phase 2 — Post to Avvale</p>
                  <p className="text-xs text-gray-400 mt-0.5">Download files first, then copy the manifest and paste it to Claude in chat</p>
                </div>
                <button
                  onClick={copyManifest}
                  className={`text-xs px-4 py-2 rounded-lg font-medium transition-all ${
                    manifestCopied
                      ? 'bg-green-600 text-white'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {manifestCopied ? '✓ Copied!' : 'Copy Phase 2 manifest'}
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Set browser download folder to{'  '}
                <span className="font-mono">C:\Users\NicolasCourtial\OneDrive - Avvale S.p.A\Documents\9. Admin\Expenses\</span>
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function ExpenseRow({ expense: exp, onReview, onDownload }: {
  expense: ExtractedExpense; onReview: () => void; onDownload: () => void
}) {
  const statusConfig: Record<string, { dot: string; label: string }> = {
    pending:    { dot: 'bg-gray-300', label: 'Waiting' },
    processing: { dot: 'bg-blue-400 animate-pulse', label: 'Scanning...' },
    review:     { dot: 'bg-amber-400', label: 'Needs review' },
    done:       { dot: 'bg-green-500', label: 'Done' },
    error:      { dot: 'bg-red-400', label: 'Error' },
  }
  const s = statusConfig[exp.status] || statusConfig.error
  const category = exp.resolvedCategory ? CATEGORIES[exp.resolvedCategory] : null

  return (
    <div className={`bg-white rounded-xl border px-5 py-3.5 transition-all ${
      exp.status === 'review' ? 'border-amber-300 bg-amber-50/30' :
      exp.status === 'error'  ? 'border-red-200' :
      exp.status === 'done'   ? 'border-gray-200' : 'border-gray-200 opacity-70'
    }`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-sm font-medium text-gray-900 truncate">
                {exp.merchant || exp.fileName}
              </span>
              {exp.language && <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded font-mono">{exp.language}</span>}
              {category && <span className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded font-mono">{category.code}</span>}
              {exp.fromCache && <span className="text-xs px-1.5 py-0.5 bg-teal-50 text-teal-700 rounded">cached</span>}
              {!exp.fromCache && exp.confidence === 'HIGH' && <span className="text-xs px-1.5 py-0.5 bg-green-50 text-green-700 rounded">✓</span>}
            </div>
            {exp.finalFilename && <div className="text-xs font-mono text-gray-400 mt-0.5">{exp.finalFilename}</div>}
            {exp.review_reason && <div className="text-xs text-amber-700 mt-0.5">{exp.review_reason}</div>}
            {exp.error && <div className="text-xs text-red-600 mt-0.5">{exp.error}</div>}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {exp.chfAmount != null && (
            <div className="text-right">
              <div className="text-sm font-semibold text-gray-900 tabular-nums">{exp.chfAmount.toFixed(2)} CHF</div>
              {exp.currency !== 'CHF' && exp.amount != null &&
                <div className="text-xs text-gray-400 tabular-nums">{exp.amount.toFixed(2)} {exp.currency}</div>}
            </div>
          )}
          {exp.resolvedDate && (
            <div className="text-xs text-gray-400 font-mono hidden sm:block">
              {exp.resolvedDate.slice(0,4)}-{exp.resolvedDate.slice(4,6)}-{exp.resolvedDate.slice(6,8)}
            </div>
          )}
          {exp.status === 'review' && (
            <button onClick={onReview}
              className="text-xs px-3 py-1.5 bg-amber-100 border border-amber-300 text-amber-800 rounded-lg hover:bg-amber-200 transition-colors font-medium">
              Review ↗
            </button>
          )}
          {exp.status === 'done' && exp.finalFilename && (
            <button onClick={onDownload}
              className="text-xs px-3 py-1.5 bg-gray-100 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors">
              ↓
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function CachePanel({ cache, stats, onClose, onClear, onRemove }: {
  cache: MatchCache
  stats: ReturnType<typeof getCacheStats>
  onClose: () => void
  onClear: () => void
  onRemove: (key: string) => void
}) {
  const entries = Object.entries(cache).sort((a, b) => b[1].hits - a[1].hits)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Merchant cache</h2>
            <p className="text-xs text-gray-400 mt-0.5">{stats.merchants} merchants · {stats.totalHits} total matches</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg px-2">×</button>
        </div>
        <div className="overflow-y-auto flex-1 p-4">
          {entries.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">No cached merchants yet. Process some receipts first.</p>
          ) : (
            <div className="space-y-1">
              {entries.map(([key, entry]) => (
                <div key={key} className="flex items-center justify-between text-xs py-2 px-3 rounded-lg hover:bg-gray-50 group">
                  <div className="min-w-0">
                    <span className="font-mono text-gray-800 font-medium">{key}</span>
                    <span className="ml-2 text-gray-400">→</span>
                    <span className="ml-2 text-blue-700 font-mono">{entry.category}</span>
                    {entry.source === 'manual' && <span className="ml-2 text-purple-600">manual</span>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    <span className="text-gray-400">{entry.hits}×</span>
                    <button
                      onClick={() => onRemove(key)}
                      className="text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity px-1"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-gray-100 flex justify-between">
          <button onClick={onClear}
            className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 transition-colors">
            Clear all
          </button>
          <button onClick={onClose}
            className="text-xs px-4 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function ReviewCard({ expense: exp, dateOnly, onConfirm, onSkip }: {
  expense: ExtractedExpense; dateOnly: boolean
  onConfirm: (date: string, category: string) => void; onSkip: () => void
}) {
  const todayStr = new Date().toISOString().split('T')[0]
  const initDate = exp.resolvedDate
    ? `${exp.resolvedDate.slice(0,4)}-${exp.resolvedDate.slice(4,6)}-${exp.resolvedDate.slice(6,8)}`
    : ''
  const [date, setDate] = useState(initDate)
  const [category, setCategory] = useState(exp.resolvedCategory || exp.category_code || '')
  const valid = date && (dateOnly || category)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full bg-amber-400" />
          <h2 className="text-sm font-semibold text-gray-900">
            {dateOnly ? 'Date missing on receipt' : 'Review required'}
          </h2>
        </div>
        <p className="text-xs text-gray-500 mb-5 ml-4">
          {exp.merchant || exp.fileName}
          {exp.review_reason && ` — ${exp.review_reason}`}
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Date {exp.date_missing && <span className="text-amber-600 font-normal">(missing on receipt)</span>}
            </label>
            <input type="date" value={date} max={todayStr}
              onChange={e => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
          </div>
          {!dateOnly && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <option value="">Select category...</option>
                {CATEGORY_LIST.map(c => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))}
              </select>
            </div>
          )}
          {exp.chfAmount != null && (
            <div className="bg-gray-50 rounded-xl px-4 py-3 text-xs text-gray-600">
              <span className="font-semibold text-gray-800">{exp.chfAmount.toFixed(2)} CHF</span>
              {exp.fxNote && <span className="ml-2 text-gray-400">{exp.fxNote}</span>}
            </div>
          )}
        </div>
        <div className="flex justify-between items-center mt-6">
          <button onClick={onSkip} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">Skip file</button>
          <button
            onClick={() => { if (valid) onConfirm(date.replace(/-/g,''), category || exp.category_code || '') }}
            disabled={!valid}
            className="text-sm px-5 py-2.5 bg-gray-900 text-white rounded-xl hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-medium">
            Confirm & continue
          </button>
        </div>
      </div>
    </div>
  )
}
