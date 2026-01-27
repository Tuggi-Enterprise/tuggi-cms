'use client'

import React, { useEffect, useState } from 'react'

export default function MyPoisPage() {
  const [pois, setPois] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/clients/my-pois')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to fetch')
        setPois(data.pois || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <div className="py-8 text-center">Loading your POIs...</div>
  if (error) return <div className="py-8 text-center text-red-600">Error: {error}</div>

  if (pois.length === 0) return <div className="py-8 text-center">You have not created any POIs yet.</div>

  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja apagar este POI? Esta ação é irreversível.')) return
    try {
      const res = await fetch(`/api/clients/pois/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      setPois(prev => prev.filter(p => p.id !== id))
      alert('POI deletado com sucesso')
    } catch (err) {
      alert('Erro ao deletar: ' + (err instanceof Error ? err.message : 'Unknown'))
    }
  }

  const handleEdit = async (id: string) => {
    const newName = prompt('Novo nome do POI:')
    if (newName === null) return
    try {
      const res = await fetch(`/api/clients/pois/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update')
      setPois(prev => prev.map(p => p.id === id ? data.updated : p))
      alert('POI atualizado com sucesso')
    } catch (err) {
      alert('Erro ao atualizar: ' + (err instanceof Error ? err.message : 'Unknown'))
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Meus POIs</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {pois.map((p: any) => (
          <div key={p.id} className="p-4 border rounded-md bg-white">
            <h3 className="font-semibold">{p.name}</h3>
            <p className="text-sm text-gray-600">{p.city}, {p.state}</p>
            <p className="text-sm text-gray-500 mt-2">Status: {p.approved ? 'Aprovado' : 'Pendente'}</p>
            <p className="text-xs text-gray-400 mt-2">Criado em: {new Date(p.created_at).toLocaleString()}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => handleEdit(p.id)} className="px-3 py-1 bg-blue-600 text-white rounded">Editar</button>
              <button onClick={() => handleDelete(p.id)} className="px-3 py-1 bg-red-600 text-white rounded">Apagar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
