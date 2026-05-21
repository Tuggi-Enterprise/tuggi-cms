import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Allow explicit any where necessary for Supabase/Google Maps interop
      '@typescript-eslint/no-explicit-any': 'warn',
      // Unused vars as warn, not error (common in large components)
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // React hooks are handled by the next/core-web-vitals extend
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]
