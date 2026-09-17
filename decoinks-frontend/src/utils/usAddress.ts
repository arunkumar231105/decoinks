import { State } from 'country-state-city'
import { api } from '../services/api'

// Splitting a US address pasted or typed whole into one line —
// "13946 Grove Patch San Antonio, TX 78247" — into street, city, state and ZIP.

const US_STATES = State.getStatesOfCountry('US').filter(s => /^[A-Z]{2}$/.test(s.isoCode))
// Longest names first, so "West Virginia" is found before "Virginia".
const BY_NAME = [...US_STATES].sort((a, b) => b.name.length - a.name.length)

export interface UsAddressParts {
  street: string
  /** Empty when the address gives no comma before the city; the ZIP then tells it. */
  city: string
  state: string
  zip: string
}

export function splitUsAddress(input: string): UsAddressParts | null {
  let rest = input.replace(/\s+/g, ' ').trim()
    .replace(/[,\s]+(U\.?S\.?A?\.?|United States( of America)?)$/i, '')

  // The ZIP ends the address; without one the address is not finished yet.
  const zipMatch = rest.match(/^(.*?)[,\s]+(\d{5})(?:-\d{4})?$/)
  if (!zipMatch) return null
  rest = zipMatch[1]
  const zip = zipMatch[2]

  let state = ''
  const code = rest.match(/^(.*?)[,\s]+([A-Za-z]{2})\.?$/)
  if (code && US_STATES.some(s => s.isoCode === code[2].toUpperCase())) {
    rest = code[1]
    state = code[2].toUpperCase()
  } else {
    const lower = rest.toLowerCase()
    const named = BY_NAME.find(s => {
      const name = s.name.toLowerCase()
      return lower.endsWith(name) && /[,\s]$/.test(lower.slice(0, lower.length - name.length))
    })
    if (named) {
      rest = rest.slice(0, rest.length - named.name.length)
      state = named.isoCode
    }
  }
  if (!state) return null

  rest = rest.replace(/[,\s]+$/, '')
  let city = ''
  const comma = rest.lastIndexOf(',')
  if (comma > 0) {
    city = rest.slice(comma + 1).trim()
    rest = rest.slice(0, comma).replace(/[,\s]+$/, '')
  }
  const street = rest.trim()
  if (!/[A-Za-z]/.test(street)) return null
  return { street, city, state, zip }
}

export interface ZipPlace { zip: string; city: string; state: string; cities?: string[] }

/** City and state for a US ZIP, or null when it cannot be told. */
export async function lookupZip(zip: string): Promise<ZipPlace | null> {
  if (!/^\d{5}$/.test(zip)) return null
  try {
    const { data } = await api.get(`/customers/zip-lookup/${zip}`)
    return data?.data ?? null
  } catch {
    return null
  }
}

/**
 * The street with the city taken off its end, when the address named the city
 * without a comma ("13946 Grove Patch San Antonio"). Null when none of the
 * ZIP's towns is what the street ends with.
 */
export function streetWithoutCity(street: string, place: ZipPlace): { street: string; city: string } | null {
  const towns = [...new Set([place.city, ...(place.cities ?? [])])].filter(Boolean)
    .sort((a, b) => b.length - a.length)
  const lower = street.toLowerCase()
  for (const town of towns) {
    const name = town.toLowerCase()
    if (lower.endsWith(name) && /[,\s]$/.test(lower.slice(0, lower.length - name.length))) {
      return { street: street.slice(0, street.length - town.length).replace(/[,\s]+$/, ''), city: town }
    }
  }
  return null
}
