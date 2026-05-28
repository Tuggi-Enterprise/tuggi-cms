import type { TaxIdType } from '@/types/clients'

export interface TaxIdEntry {
  type: TaxIdType
  label: string
  placeholder: string
}

export const TAX_ID_CONFIG: Record<string, TaxIdEntry> = {
  Brazil: { type: 'cnpj', label: 'CNPJ', placeholder: 'XX.XXX.XXX/XXXX-XX' },
  Portugal: { type: 'nipc', label: 'NIPC', placeholder: '9 dígitos' },
  Spain: { type: 'nif', label: 'NIF/CIF', placeholder: 'A12345678' },
  France: { type: 'vat', label: 'SIRET / TVA', placeholder: 'FRXX 123456789' },
  Germany: { type: 'vat', label: 'USt-IdNr', placeholder: 'DE123456789' },
  Italy: { type: 'vat', label: 'Partita IVA', placeholder: 'IT12345678901' },
  Netherlands: { type: 'vat', label: 'BTW-nummer', placeholder: 'NL123456789B01' },
  'United States': { type: 'ein', label: 'EIN', placeholder: 'XX-XXXXXXX' },
  'United Kingdom': { type: 'vat', label: 'VAT Number', placeholder: 'GB123456789' },
}

export const DEFAULT_TAX_ID: TaxIdEntry = {
  type: 'other',
  label: 'Tax ID',
  placeholder: 'Enter tax ID',
}

export const COUNTRIES = [
  'Brazil', 'Portugal', 'Spain', 'France', 'Germany', 'Italy', 'Netherlands',
  'United Kingdom', 'United States', 'Belgium', 'Austria', 'Switzerland',
  'Ireland', 'Luxembourg', 'Greece', 'Poland', 'Czech Republic', 'Sweden',
  'Denmark', 'Norway', 'Finland', 'Canada', 'Mexico', 'Argentina', 'Chile',
  'Colombia', 'Peru', 'Australia', 'Japan', 'South Korea',
].sort()

const NON_IBAN_COUNTRIES = ['United States', 'Canada']

export function usesBankingIBAN(country: string): boolean {
  return !NON_IBAN_COUNTRIES.includes(country)
}

export function taxConfigFor(country: string): TaxIdEntry {
  return TAX_ID_CONFIG[country] ?? DEFAULT_TAX_ID
}
