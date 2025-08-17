import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(date: string | Date) {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function truncateText(text: string, maxLength: number) {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => func(...args), delay)
  }
}

// Country code to full name mapping
export const COUNTRY_NAMES: Record<string, string> = {
  'BR': 'Brazil',
  'US': 'United States',
  'GB': 'United Kingdom', 
  'CA': 'Canada',
  'AU': 'Australia',
  'FR': 'France',
  'DE': 'Germany',
  'IT': 'Italy',
  'ES': 'Spain',
  'PT': 'Portugal',
  'AR': 'Argentina',
  'MX': 'Mexico',
  'CL': 'Chile',
  'CO': 'Colombia',
  'PE': 'Peru',
  'UY': 'Uruguay',
  'PY': 'Paraguay',
  'BO': 'Bolivia',
  'EC': 'Ecuador',
  'VE': 'Venezuela',
  'JP': 'Japan',
  'KR': 'South Korea',
  'CN': 'China',
  'IN': 'India',
  'RU': 'Russia',
  'NL': 'Netherlands',
  'BE': 'Belgium',
  'CH': 'Switzerland',
  'AT': 'Austria',
  'SE': 'Sweden',
  'NO': 'Norway',
  'DK': 'Denmark',
  'FI': 'Finland',
  'PL': 'Poland',
  'CZ': 'Czech Republic',
  'HU': 'Hungary',
  'GR': 'Greece',
  'TR': 'Turkey',
  'ZA': 'South Africa',
  'EG': 'Egypt',
  'MA': 'Morocco',
  'NG': 'Nigeria',
  'KE': 'Kenya',
  'TH': 'Thailand',
  'SG': 'Singapore',
  'MY': 'Malaysia',
  'ID': 'Indonesia',
  'PH': 'Philippines',
  'VN': 'Vietnam',
  'NZ': 'New Zealand',
  'IL': 'Israel',
  'AE': 'United Arab Emirates',
  'SA': 'Saudi Arabia',
  'QA': 'Qatar',
  'KW': 'Kuwait',
  'BH': 'Bahrain',
  'OM': 'Oman',
  'JO': 'Jordan',
  'LB': 'Lebanon',
  'IE': 'Ireland',
  'IS': 'Iceland',
  'LU': 'Luxembourg',
  'MT': 'Malta',
  'CY': 'Cyprus',
  'HR': 'Croatia',
  'SI': 'Slovenia',
  'SK': 'Slovakia',
  'BG': 'Bulgaria',
  'RO': 'Romania',
  'LT': 'Lithuania',
  'LV': 'Latvia',
  'EE': 'Estonia'
}

export function getCountryName(countryCode: string): string {
  return COUNTRY_NAMES[countryCode] || countryCode
}

/**
 * Extract city and country from Google Places address components
 */
export function extractLocationFromAddressComponents(addressComponents: Array<{
  long_name: string
  short_name: string
  types: string[]
}>): { city: string; country: string; countryCode: string } {
  let city = ''
  let country = ''
  let countryCode = ''

  // Extract city (locality, administrative_area_level_2, or sublocality)
  const cityComponent = addressComponents.find(component => 
    component.types.includes('locality') ||
    component.types.includes('administrative_area_level_2') ||
    component.types.includes('sublocality') ||
    component.types.includes('sublocality_level_1')
  )
  
  if (cityComponent) {
    city = cityComponent.long_name
  }

  // Extract country
  const countryComponent = addressComponents.find(component => 
    component.types.includes('country')
  )
  
  if (countryComponent) {
    countryCode = countryComponent.short_name
    country = getCountryName(countryCode)
  }

  return { city, country, countryCode }
} 