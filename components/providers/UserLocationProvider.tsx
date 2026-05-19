'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'

interface UserLocation {
  lat: number
  lng: number
  accuracy?: number
  timestamp?: number
}

interface UserLocationContextType {
  userLocation: UserLocation | null
  isLoading: boolean
  error: string | null
  requestLocation: () => Promise<UserLocation | null>
}

const UserLocationContext = createContext<UserLocationContextType>({
  userLocation: null,
  isLoading: true,
  error: null,
  requestLocation: async () => null,
})

export const useUserLocation = () => useContext(UserLocationContext)

export function UserLocationProvider({ children }: { children: React.ReactNode }) {
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const requestLocation = async (): Promise<UserLocation | null> => {
    console.log('📡 [Location] Requesting fresh location...')
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        const err = 'Geolocation is not supported by your browser'
        setError(err)
        setIsLoading(false)
        resolve(null)
        return
      }

      const getPosition = (highAccuracy: boolean) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const location = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              accuracy: position.coords.accuracy,
              timestamp: position.timestamp,
            }
            setUserLocation(location)
            setIsLoading(false)
            setError(null)
            console.log(`✅ [Location] Success (${highAccuracy ? 'High Accuracy' : 'Low Accuracy'}):`, location)
            localStorage.setItem('user_location', JSON.stringify(location))
            resolve(location)
          },
          (err) => {
            // Fallback to low accuracy if high accuracy fails (except for permission denied)
            if (highAccuracy && (err.code === err.POSITION_UNAVAILABLE || err.code === err.TIMEOUT)) {
              console.warn(`⚠️ [Location] High accuracy failed (Code: ${err.code}), retrying with low accuracy...`)
              getPosition(false)
              return
            }

            console.error('❌ [Location] Error code:', err.code, 'Message:', err.message)
            let message = 'Failed to get location'
            switch (err.code) {
              case err.PERMISSION_DENIED:
                message = 'Location permission denied'
                break
              case err.POSITION_UNAVAILABLE:
                message = 'Location information is unavailable'
                break
              case err.TIMEOUT:
                message = 'Location request timed out'
                break
            }
            setError(message)
            setIsLoading(false)
            resolve(null)
          },
          {
            enableHighAccuracy: highAccuracy,
            timeout: highAccuracy ? 15000 : 10000,
            maximumAge: 300000, // 5 minutes cache
          }
        )
      }

      getPosition(true)
    })
  }

  useEffect(() => {
    // Try to load from localStorage first
    const saved = localStorage.getItem('user_location')
    if (saved) {
      try {
        setUserLocation(JSON.parse(saved))
        setIsLoading(false)
      } catch (e) {
        console.error('Failed to parse saved location', e)
      }
    }

    // Attempt to get fresh location
    requestLocation()
  }, [])

  return (
    <UserLocationContext.Provider value={{ userLocation, isLoading, error, requestLocation }}>
      {children}
    </UserLocationContext.Provider>
  )
}
