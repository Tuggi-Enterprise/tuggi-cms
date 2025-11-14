'use client'

import { useState, useEffect } from 'react'
import { useSupabaseClient } from '@supabase/auth-helpers-react'

interface Schema {
  schema_name?: string
  name?: string
}

interface Table {
  table_name?: string
  name?: string
}

interface Column {
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
  character_maximum_length: number | null
}

interface TableData {
  data: any[]
  count: number
  limit: number
}

export default function SupabaseExplorerPage() {
  const supabase = useSupabaseClient()
  const [schemas, setSchemas] = useState<string[]>([])
  const [selectedSchema, setSelectedSchema] = useState<string>('core')
  const [tables, setTables] = useState<string[]>([])
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [columns, setColumns] = useState<Column[]>([])
  const [tableData, setTableData] = useState<TableData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<any>(null)

  useEffect(() => {
    loadSchemas()
    loadStats()
  }, [])

  useEffect(() => {
    if (selectedSchema) {
      loadTables(selectedSchema)
      setSelectedTable(null)
      setColumns([])
      setTableData(null)
    }
  }, [selectedSchema])

  useEffect(() => {
    if (selectedSchema && selectedTable) {
      loadColumns(selectedSchema, selectedTable)
      loadTableData(selectedSchema, selectedTable)
    }
  }, [selectedSchema, selectedTable])

  const loadSchemas = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/supabase/explore?action=schemas')
      const result = await response.json()
      setSchemas(result.schemas || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadTables = async (schema: string) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/supabase/explore?action=tables&schema=${schema}`)
      const result = await response.json()
      setTables(result.tables || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadColumns = async (schema: string, table: string) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/supabase/explore?action=columns&schema=${schema}&table=${table}`
      )
      const result = await response.json()
      setColumns(result.columns || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadTableData = async (schema: string, table: string, limit: number = 10) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/supabase/explore?action=data&schema=${schema}&table=${table}&limit=${limit}`
      )
      const result = await response.json()
      if (result.error) {
        setError(result.error)
      } else {
        setTableData(result)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    try {
      const response = await fetch('/api/supabase/explore?action=stats')
      const result = await response.json()
      setStats(result.stats)
    } catch (err) {
      // Ignore stats errors
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Supabase Database Explorer
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Visualização de leitura do banco de dados Supabase na nuvem
          </p>
        </div>

        {stats && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <h2 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
              Status da Conexão
            </h2>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-600 dark:text-gray-400">URL:</span>{' '}
                <span className={stats.connection?.url === 'configured' ? 'text-green-600' : 'text-red-600'}>
                  {stats.connection?.url || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Anon Key:</span>{' '}
                <span className={stats.connection?.hasAnonKey ? 'text-green-600' : 'text-red-600'}>
                  {stats.connection?.hasAnonKey ? '✓' : '✗'}
                </span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Service Key:</span>{' '}
                <span className={stats.connection?.hasServiceKey ? 'text-green-600' : 'text-red-600'}>
                  {stats.connection?.hasServiceKey ? '✓' : '✗'}
                </span>
              </div>
            </div>
            {stats.tables && (
              <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-800">
                <h3 className="text-xs font-semibold text-blue-900 dark:text-blue-100 mb-2">
                  Contadores de Tabelas
                </h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(stats.tables).map(([table, count]) => (
                    <div key={table}>
                      <span className="text-gray-600 dark:text-gray-400">{table}:</span>{' '}
                      <span className="font-mono text-blue-700 dark:text-blue-300">{count as number}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-12 gap-6">
          {/* Schema Selector */}
          <div className="col-span-3">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Schemas
              </h2>
              <div className="space-y-2">
                {schemas.map((schema) => (
                  <button
                    key={schema}
                    onClick={() => setSelectedSchema(schema)}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                      selectedSchema === schema
                        ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100 font-medium'
                        : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                  >
                    {schema}
                  </button>
                ))}
              </div>
            </div>

            {/* Tables List */}
            {tables.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mt-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Tabelas ({selectedSchema})
                </h2>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {tables.map((table) => (
                    <button
                      key={table}
                      onClick={() => setSelectedTable(table)}
                      className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                        selectedTable === table
                          ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100 font-medium'
                          : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                      }`}
                    >
                      {table}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Main Content */}
          <div className="col-span-9">
            {selectedTable ? (
              <div className="space-y-4">
                {/* Columns */}
                {columns.length > 0 && (
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                      Colunas: {selectedSchema}.{selectedTable}
                    </h2>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-700">
                            <th className="text-left py-2 px-3 text-gray-700 dark:text-gray-300">Nome</th>
                            <th className="text-left py-2 px-3 text-gray-700 dark:text-gray-300">Tipo</th>
                            <th className="text-left py-2 px-3 text-gray-700 dark:text-gray-300">Nullable</th>
                            <th className="text-left py-2 px-3 text-gray-700 dark:text-gray-300">Default</th>
                          </tr>
                        </thead>
                        <tbody>
                          {columns.map((col, idx) => (
                            <tr
                              key={col.column_name}
                              className="border-b border-gray-100 dark:border-gray-700"
                            >
                              <td className="py-2 px-3 font-mono text-gray-900 dark:text-gray-100">
                                {col.column_name}
                              </td>
                              <td className="py-2 px-3 text-gray-600 dark:text-gray-400">
                                {col.data_type}
                                {col.character_maximum_length && (
                                  <span className="text-gray-400">({col.character_maximum_length})</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-gray-600 dark:text-gray-400">
                                {col.is_nullable === 'YES' ? '✓' : '✗'}
                              </td>
                              <td className="py-2 px-3 text-gray-500 dark:text-gray-500 font-mono text-xs">
                                {col.column_default || '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Table Data */}
                {tableData && (
                  <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                    <div className="flex justify-between items-center mb-4">
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                        Dados (mostrando {tableData.data.length} de {tableData.count})
                      </h2>
                      <button
                        onClick={() => loadTableData(selectedSchema, selectedTable, tableData.limit + 10)}
                        className="px-3 py-1 text-sm bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
                      >
                        Carregar mais
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-700">
                            {columns.slice(0, 10).map((col) => (
                              <th
                                key={col.column_name}
                                className="text-left py-2 px-2 text-gray-700 dark:text-gray-300 font-medium"
                              >
                                {col.column_name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tableData.data.map((row: any, idx: number) => (
                            <tr
                              key={idx}
                              className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              {columns.slice(0, 10).map((col) => (
                                <td
                                  key={col.column_name}
                                  className="py-2 px-2 text-gray-600 dark:text-gray-400"
                                >
                                  {row[col.column_name] !== null && row[col.column_name] !== undefined
                                    ? typeof row[col.column_name] === 'object'
                                      ? JSON.stringify(row[col.column_name]).substring(0, 50) + '...'
                                      : String(row[col.column_name]).substring(0, 50)
                                    : (
                                        <span className="text-gray-400 italic">null</span>
                                      )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
                <p className="text-gray-500 dark:text-gray-400">
                  Selecione uma tabela para visualizar seus dados
                </p>
              </div>
            )}
          </div>
        </div>

        {loading && (
          <div className="fixed bottom-4 right-4 bg-blue-500 text-white px-4 py-2 rounded shadow-lg">
            Carregando...
          </div>
        )}
      </div>
    </div>
  )
}








