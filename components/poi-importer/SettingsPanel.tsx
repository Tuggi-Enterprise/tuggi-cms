import { COUNTRIES } from '@/constants/poi-importer'
import { useTranslations } from 'next-intl'

interface SettingsPanelProps {
  selectedCountry: string
  onCountryChange: (country: string) => void
}

export function SettingsPanel({
  selectedCountry,
  onCountryChange
}: SettingsPanelProps) {
  const t = useTranslations('Pages.POIImporter.settings')
  const tOSMTable = useTranslations('Pages.OSMImporter.table')
  return (
    <div className="p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-3">{t('title')}</h3>
      <div>
        <label className="text-xs text-gray-600">{tOSMTable('country')}</label>
        <select
          value={selectedCountry}
          onChange={(e) => onCountryChange(e.target.value)}
          className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        >
          {COUNTRIES.map((country) => (
            <option key={country.value} value={country.value}>
              {country.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
} 