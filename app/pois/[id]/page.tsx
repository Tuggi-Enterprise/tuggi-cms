'use client'

import { useState, useEffect } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { useRouter } from 'next/navigation'
import { POIDetailsModal, type POI } from '@/components/poi-management/POIDetailsModal'
import { ArrowLeft, Loader2 } from 'lucide-react'

interface POIPageProps {
  params: {
    id: string
  }
}

export default function POIPage({ params }: POIPageProps) {
  const [poi, setPoi] = useState<POI | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(true)
  
  const supabase = useSupabaseClient()
  const router = useRouter()

  useEffect(() => {
    const fetchPOI = async () => {
      try {
        setIsLoading(true)
        setError(null)

        const { data, error: fetchError } = await supabase
          .schema('core')
          .from('attractions')
          .select(`
            id,
            name,
            description,
            address,
            city,
            state,
            country,
            latitude,
            longitude,
            google_types,
            approved,
            user_id,
            created_at,
            updated_at,
            attraction_descriptions (
              id,
              description,
              language,
              created_at
            ),
            attraction_groups (
              id,
              name,
              status
            )
          `)
          .eq('id', params.id)
          .single()

        if (fetchError) {
          console.error('Error fetching POI:', fetchError)
          setError('POI não encontrado')
          return
        }

        if (!data) {
          setError('POI não encontrado')
          return
        }

        // Transform the data to match the POI interface
        const transformedPOI: POI = {
          id: data.id,
          name: data.name,
          city: data.city,
          country: data.country,
          state: data.state,
          category: data.google_types?.[0] || 'point_of_interest',
          approved: data.approved,
          approved_by: null,
          approved_at: null,
          rating: null,
          image_url: null,
          created_at: data.created_at,
          updated_at: data.updated_at,
          user_ratings_total: null,
          formatted_address: data.address,
          vicinity: null,
          website: null,
          formatted_phone_number: null,
          business_status: null,
          price_level: null,
          opening_hours: null,
          google_types: data.google_types,
          photos_references: null,
          google_place_id: null,
          user_id: data.user_id || null,
          coordinates: data.latitude && data.longitude ? {
            latitude: data.latitude,
            longitude: data.longitude
          } : undefined,
          has_description: (data.attraction_descriptions?.length || 0) > 0,
          has_audio: false,
          description_count: data.attraction_descriptions?.length || 0,
          audio_count: 0,
          available_languages: data.attraction_descriptions?.map(d => d.language) || [],
          trigger_points_count: 0,
          active_trigger_points_count: 0,
          reference_links: [],
          group_status: data.attraction_groups?.[0] ? {
            is_in_group: true,
            group_id: data.attraction_groups[0].id,
            group_name: data.attraction_groups[0].name,
            group_role: 'main',
            group_member_count: 1
          } : undefined
        }

        setPoi(transformedPOI)
      } catch (err) {
        console.error('Error fetching POI:', err)
        setError('Erro ao carregar POI')
      } finally {
        setIsLoading(false)
      }
    }

    if (params.id) {
      fetchPOI()
    }
  }, [params.id, supabase])

  const handleClose = () => {
    setIsModalOpen(false)
    // Navigate back to the POIs list
    router.push('/pois')
  }

  const handleUpdate = () => {
    // Optionally show a success message or navigate back
    router.push('/pois')
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-tuggi-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 text-tuggi-blue animate-spin mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Carregando POI...</p>
        </div>
      </div>
    )
  }

  if (error || !poi) {
    return (
      <div className="min-h-screen bg-tuggi-background flex items-center justify-center">
        <div className="text-center">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 max-w-md">
            <h2 className="text-xl font-semibold text-red-800 dark:text-red-200 mb-2">
              POI não encontrado
            </h2>
            <p className="text-red-600 dark:text-red-300 mb-4">
              {error || 'O POI solicitado não foi encontrado ou não existe.'}
            </p>
            <button
              onClick={() => router.push('/pois')}
              className="inline-flex items-center px-4 py-2 bg-tuggi-blue text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Voltar para POIs
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-tuggi-background">
      {/* Header with back button */}
      <div className="fixed top-4 left-4 z-50">
        <button
          onClick={handleClose}
          className="inline-flex items-center px-4 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg shadow-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors border border-gray-200 dark:border-gray-600"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar para POIs
        </button>
      </div>

      {/* Background overlay */}
      <div className="fixed inset-0 bg-black/50 z-40" onClick={handleClose} />
      
      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
          <POIDetailsModal
            poi={poi}
            isOpen={isModalOpen}
            onClose={handleClose}
            onUpdate={handleUpdate}
          />
        </div>
      </div>
    </div>
  )
}
