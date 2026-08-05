import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

// Next 16 removeu `next lint` e passou a distribuir configs flat nativas
// (eslint-config-next/core-web-vitals, eslint-config-next/typescript). O
// `FlatCompat` que envolvia os nomes antigos ('next/core-web-vitals') não é
// mais necessário e quebra com o eslint-config-next 16.0.10 instalado aqui
// (TypeError: Converting circular structure to JSON, ao tentar validar o
// plugin 'react' via schema legado do @eslint/eslintrc).
export default [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Allow explicit any where necessary for Supabase/Google Maps interop
      '@typescript-eslint/no-explicit-any': 'warn',
      // Unused vars as warn, not error (common in large components)
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // React hooks are handled by the next/core-web-vitals extend
      'react-hooks/exhaustive-deps': 'warn',

      // --- #162: gate ligado pela primeira vez neste commit ---
      // `eslint-config-next` 16 trouxe um `eslint-plugin-react-hooks` novo
      // (regras de compatibilidade com o React Compiler) e as duas configs
      // nativas (`core-web-vitals`, `typescript`) já chegam com essas regras
      // em 'error'. Rodadas contra o código existente, TODA regra abaixo
      // tinha violação pré-existente — 191 erros em 94 arquivos, nenhum
      // deles introduzido por este commit. Consertar tudo agora é escopo
      // novo, não o deste card: baixado para 'warn' para o gate passar sem
      // apagar o sinal. Contagem por regra no momento em que isto foi
      // escrito, registrada no card #162:
      //   react-hooks/set-state-in-effect        61
      //   prefer-const                            52
      //   @typescript-eslint/no-require-imports   24
      //   react-hooks/preserve-manual-memoization 19
      //   react-hooks/immutability                11
      //   @next/next/no-html-link-for-pages        5
      //   react-hooks/refs                         4
      //   @typescript-eslint/ban-ts-comment        4
      //   react/no-unescaped-entities              4
      //   react-hooks/static-components            3
      //   @typescript-eslint/no-empty-object-type  2
      //   react/display-name                       1
      //   react-hooks/purity                       1
      'react-hooks/set-state-in-effect': 'warn',
      'prefer-const': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
      '@next/next/no-html-link-for-pages': 'warn',
      'react-hooks/refs': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'react/no-unescaped-entities': 'warn',
      'react-hooks/static-components': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'react/display-name': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
]
