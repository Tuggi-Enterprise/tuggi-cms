import { 
  Target, Building2, TreePine, Church, Dumbbell, BookOpen, 
  Waves, Mountain, Gamepad2, Palette, ShoppingBag, UtensilsCrossed,
  Bed, Cross, GraduationCap 
} from 'lucide-react'
import { POICategory, Country } from '@/types/poi-importer'

export const POI_CATEGORIES: POICategory[] = [
  { value: 'all', label: 'All Categories', icon: Target, color: 'bg-gray-500' },
  { value: 'tourist_attraction', label: 'Tourist Attractions', icon: Target, color: 'bg-blue-500' },
  { value: 'viewpoint', label: 'Viewpoints', icon: Palette, color: 'bg-indigo-400' },
  { value: 'museum', label: 'Museums', icon: Building2, color: 'bg-purple-500' },
  { value: 'city', label: 'Cities', icon: TreePine, color: 'bg-green-500' },
  { value: 'park', label: 'Parks & Gardens', icon: TreePine, color: 'bg-green-500' },
  { value: 'beach', label: 'Beaches', icon: Waves, color: 'bg-blue-400' },
  { value: 'church', label: 'Religious Sites', icon: Church, color: 'bg-amber-600' },
  { value: 'historic', label: 'Historic Sites', icon: Building2, color: 'bg-stone-500' },
  { value: 'stadium', label: 'Sports Venues', icon: Dumbbell, color: 'bg-red-500' },
  { value: 'library', label: 'Libraries', icon: BookOpen, color: 'bg-indigo-500' },
  { value: 'aquarium', label: 'Aquariums', icon: Waves, color: 'bg-cyan-500' },
  { value: 'zoo', label: 'Zoos & Wildlife', icon: Mountain, color: 'bg-emerald-500' },
  { value: 'amusement_park', label: 'Amusement Parks', icon: Gamepad2, color: 'bg-pink-500' },
  { value: 'art_gallery', label: 'Art Galleries', icon: Palette, color: 'bg-violet-500' },
  { value: 'shopping_mall', label: 'Shopping Malls', icon: ShoppingBag, color: 'bg-orange-500' },
  { value: 'restaurant', label: 'Restaurants', icon: UtensilsCrossed, color: 'bg-yellow-600' },
  { value: 'lodging', label: 'Hotels & Lodging', icon: Bed, color: 'bg-teal-500' },
  { value: 'hospital', label: 'Healthcare', icon: Cross, color: 'bg-red-600' },
  { value: 'university', label: 'Universities', icon: GraduationCap, color: 'bg-blue-600' },
]

export const COUNTRIES: Country[] = [
  { value: '', label: 'Auto-detect' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'FR', label: 'France' },
  { value: 'DE', label: 'Germany' },
  { value: 'IT', label: 'Italy' },
  { value: 'ES', label: 'Spain' },
  { value: 'PT', label: 'Portugal' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'BE', label: 'Belgium' },
  { value: 'CH', label: 'Switzerland' },
  { value: 'AT', label: 'Austria' },
  { value: 'JP', label: 'Japan' },
  { value: 'AU', label: 'Australia' },
  { value: 'CA', label: 'Canada' },
  { value: 'BR', label: 'Brazil' },
]

export const DEFAULT_MAP_CENTER = { lat: 37.7749, lng: -122.4194 }
export const DEFAULT_MAP_ZOOM = 12 