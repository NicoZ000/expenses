import { NextResponse } from 'next/server'
import { fetchRates, getRateDisplay } from '@/lib/fxRates'

export async function GET() {
  const rates = await fetchRates()
  return NextResponse.json({
    rates: rates.rates,
    fetchedDate: rates.fetchedDate,
    fetchedAt: rates.fetchedAt,
    display: getRateDisplay(rates),
  })
}
