import { NextRequest, NextResponse } from 'next/server'
import { CLASSIFICATION_SYSTEM_PROMPT } from '@/lib/categoryMap'
import { fetchRates, convertToChf, formatFxNote } from '@/lib/fxRates'

export const maxDuration = 60
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    // Determine media type
    const mediaType = file.type === 'application/pdf' ? 'application/pdf' : 'image/jpeg'

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: CLASSIFICATION_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64,
                },
              },
              {
                type: 'text',
                text: 'Analyse this expense receipt and return the JSON as specified.',
              },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return NextResponse.json({ error: `Claude API error: ${err}` }, { status: 500 })
    }

    const claudeData = await response.json()
    const rawText = claudeData.content?.[0]?.text || ''

    // Parse JSON from Claude response
    let extracted: Record<string, unknown>
    try {
      const clean = rawText.replace(/```json\n?|\n?```/g, '').trim()
      extracted = JSON.parse(clean)
    } catch {
      return NextResponse.json({ error: 'Failed to parse Claude response', raw: rawText }, { status: 500 })
    }

    // Fetch FX rates
    const rates = await fetchRates()

    // Compute CHF conversion
    const currency = (extracted.currency as string) || 'EUR'
    const amount = extracted.amount as number | null
    let chfAmount: number | null = null
    let fxNote: string | null = null

    if (amount !== null && amount !== undefined) {
      chfAmount = convertToChf(amount, currency, rates)
      if (currency !== 'CHF') {
        const rate = rates.rates[currency] || 1
        fxNote = formatFxNote(amount, currency, chfAmount, rate, rates.fetchedDate)
      }
    }

    return NextResponse.json({
      ...extracted,
      chfAmount,
      fxNote,
      ratesSnapshot: {
        fetchedDate: rates.fetchedDate,
        rate: currency !== 'CHF' ? rates.rates[currency] : null,
      },
    })
  } catch (err) {
    console.error('OCR error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
