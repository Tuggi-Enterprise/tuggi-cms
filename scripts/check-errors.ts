#!/usr/bin/env tsx

import { execSync } from 'child_process';
import { existsSync } from 'fs';

console.log('🔍 Verificando erros no projeto...\n');

// Verificar se os arquivos de configuração existem
const configFiles = [
  'tsconfig.json',
  'tsconfig.app.json',
  '.eslintrc.json'
];

for (const file of configFiles) {
  if (!existsSync(file)) {
    console.log(`❌ Arquivo de configuração não encontrado: ${file}`);
    process.exit(1);
  }
}

console.log('✅ Arquivos de configuração encontrados\n');

try {
  // Verificar TypeScript
  console.log('🔍 Verificando erros de TypeScript...');
  execSync('npm run type-check:app', { stdio: 'inherit' });
  console.log('✅ TypeScript: Sem erros\n');

  // Verificar ESLint
  console.log('🔍 Verificando erros de ESLint...');
  execSync('npm run lint', { stdio: 'inherit' });
  console.log('✅ ESLint: Sem erros\n');

  console.log('🎉 Todas as verificações passaram! O projeto está pronto para build.');

} catch (error) {
  console.error('❌ Erros encontrados durante a verificação:');
  console.error(error);
  process.exit(1);
}
