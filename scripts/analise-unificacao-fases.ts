/**
 * Análise de Unificação de Fases
 * 
 * Objetivo: Identificar fases que podem ser unificadas sem alterar o resultado final
 */

interface FaseInfo {
  nome: string;
  tipo: 'filtro' | 'refinamento' | 'deduplicacao';
  criterio: string;
  dependencias: string[];
  podeUnificar: boolean;
  motivo: string;
}

const fases: FaseInfo[] = [
  {
    nome: 'ETAPA 1',
    tipo: 'filtro',
    criterio: 'Incluir categorias (tourism, historic, natural, leisure) + igrejas católicas - excluir highways',
    dependencias: [],
    podeUnificar: false,
    motivo: 'Filtro base que define o conjunto inicial. Deve ser mantido separado.'
  },
  {
    nome: 'ETAPA 2',
    tipo: 'filtro',
    criterio: 'Remover POIs privados (mantendo tourism/historic)',
    dependencias: ['ETAPA 1'],
    podeUnificar: false,
    motivo: 'Filtro de acesso público. Deve ser executado após ETAPA 1.'
  },
  {
    nome: 'ETAPA 3',
    tipo: 'refinamento',
    criterio: 'Filtrar por importância (refinamento por categoria)',
    dependencias: ['ETAPA 2'],
    podeUnificar: false,
    motivo: 'Refinamento por categoria. Pode ser opcional mas mantém qualidade.'
  },
  {
    nome: 'ETAPA 4',
    tipo: 'filtro',
    criterio: 'Remover POIs problemáticos: sem nome E sem referências, fazendas privadas, aeródromos privados',
    dependencias: ['ETAPA 3'],
    podeUnificar: true,
    motivo: 'Pode ser unificada com ETAPA 5 (ambas removem POIs sem valor turístico)'
  },
  {
    nome: 'ETAPA 5',
    tipo: 'filtro',
    criterio: 'Remover POIs genéricos sem valor: sem nome E sem refs, infraestrutura técnica, nomes genéricos, estádios/cemitérios genéricos',
    dependencias: ['ETAPA 4'],
    podeUnificar: true,
    motivo: 'Pode ser unificada com ETAPA 4 e 5.1-5.5 (todas removem POIs sem valor turístico por critérios diferentes)'
  },
  {
    nome: 'ETAPA 5.1',
    tipo: 'filtro',
    criterio: 'Remover bancos e instituições financeiras sem valor turístico',
    dependencias: ['ETAPA 5'],
    podeUnificar: true,
    motivo: 'Pode ser unificada com ETAPA 5 (ambas filtram por nome/tipo sem valor turístico)'
  },
  {
    nome: 'ETAPA 5.2',
    tipo: 'filtro',
    criterio: 'Remover estradas, ruas, avenidas e vias de trâfego (por nome)',
    dependencias: ['ETAPA 5.1'],
    podeUnificar: true,
    motivo: 'Pode ser unificada com ETAPA 5 (ambas filtram por padrões de nome)'
  },
  {
    nome: 'ETAPA 5.3',
    tipo: 'filtro',
    criterio: 'Remover nomes genéricos sem contexto (mirante, monumento, busto, etc.)',
    dependencias: ['ETAPA 5.2'],
    podeUnificar: true,
    motivo: 'Pode ser unificada com ETAPA 5 (ambas filtram nomes genéricos)'
  },
  {
    nome: 'ETAPA 5.4',
    tipo: 'filtro',
    criterio: 'Remover POIs específicos (Rotary, SESC, Torre, Trilha, Via de acesso, Vila)',
    dependencias: ['ETAPA 5.3'],
    podeUnificar: true,
    motivo: 'Pode ser unificada com ETAPA 5 (ambas filtram por nomes específicos)'
  },
  {
    nome: 'ETAPA 5.5',
    tipo: 'filtro',
    criterio: 'Remover infraestrutura e serviços (aeródromos, escolas, serviços públicos, comércio)',
    dependencias: ['ETAPA 5.4'],
    podeUnificar: true,
    motivo: 'Pode ser unificada com ETAPA 5 (ambas filtram infraestrutura sem valor turístico)'
  },
  {
    nome: 'ETAPA 5.6',
    tipo: 'deduplicacao',
    criterio: 'Remover duplicatas (mesmo nome e localização < 500m)',
    dependencias: ['ETAPA 5.5'],
    podeUnificar: false,
    motivo: 'Deduplicação requer análise de distância. Deve ser executada após todos os filtros.'
  },
  {
    nome: 'ETAPA 5.7',
    tipo: 'filtro',
    criterio: 'Remover POIs com nome de 1 palavra sem valor (sem Wikipedia/Wikidata/descrição)',
    dependencias: ['ETAPA 5.6'],
    podeUnificar: true,
    motivo: 'Pode ser unificada com ETAPA 5 (ambas filtram por critérios de valor turístico)'
  }
];

function analisarUnificacao() {
  console.log('='.repeat(80));
  console.log('📊 ANÁLISE DE UNIFICAÇÃO DE FASES');
  console.log('='.repeat(80));
  console.log('');
  
  console.log('📋 FASES ATUAIS:');
  fases.forEach((fase, index) => {
    console.log(`\n${index + 1}. ${fase.nome}`);
    console.log(`   Tipo: ${fase.tipo}`);
    console.log(`   Critério: ${fase.criterio}`);
    console.log(`   Dependências: ${fase.dependencias.length > 0 ? fase.dependencias.join(', ') : 'Nenhuma'}`);
    console.log(`   Pode unificar: ${fase.podeUnificar ? '✅ SIM' : '❌ NÃO'}`);
    if (fase.podeUnificar) {
      console.log(`   Motivo: ${fase.motivo}`);
    }
  });
  
  console.log('\n' + '='.repeat(80));
  console.log('💡 OPORTUNIDADES DE UNIFICAÇÃO');
  console.log('='.repeat(80));
  console.log('');
  
  // Agrupar fases que podem ser unificadas
  const gruposUnificacao = [
    {
      nome: 'GRUPO A: Filtros de Valor Turístico',
      fases: ['ETAPA 4', 'ETAPA 5', 'ETAPA 5.1', 'ETAPA 5.2', 'ETAPA 5.3', 'ETAPA 5.4', 'ETAPA 5.5'],
      criterioComum: 'Remover POIs sem valor turístico identificável',
      podeUnificar: true,
      motivo: 'Todas essas fases aplicam critérios diferentes para o mesmo objetivo: remover POIs sem valor turístico. Podem ser executadas em uma única passagem sobre os dados.',
      ordemImportante: false,
      observacao: 'A ordem dos critérios dentro do grupo não importa, pois são filtros independentes por padrão de nome/tipo.'
    },
    {
      nome: 'GRUPO B: Filtros de Nome Genérico',
      fases: ['ETAPA 5.3', 'ETAPA 5.7'],
      criterioComum: 'Remover POIs com nomes genéricos sem contexto',
      podeUnificar: true,
      motivo: 'Ambas filtram por padrões de nome genérico. ETAPA 5.3 filtra nomes específicos, ETAPA 5.7 filtra nomes de 1 palavra.',
      ordemImportante: false,
      observacao: 'Pode ser executado em uma única passagem, verificando ambos os critérios.'
    }
  ];
  
  gruposUnificacao.forEach((grupo, index) => {
    console.log(`\n${index + 1}. ${grupo.nome}`);
    console.log(`   Fases: ${grupo.fases.join(', ')}`);
    console.log(`   Critério comum: ${grupo.criterioComum}`);
    console.log(`   Pode unificar: ${grupo.podeUnificar ? '✅ SIM' : '❌ NÃO'}`);
    console.log(`   Motivo: ${grupo.motivo}`);
    if (grupo.ordemImportante) {
      console.log(`   ⚠️  ATENÇÃO: A ordem importa!`);
    } else {
      console.log(`   ✅ A ordem NÃO importa (filtros independentes)`);
    }
    if (grupo.observacao) {
      console.log(`   📝 Observação: ${grupo.observacao}`);
    }
  });
  
  console.log('\n' + '='.repeat(80));
  console.log('🎯 RECOMENDAÇÕES');
  console.log('='.repeat(80));
  console.log('');
  
  console.log('1. UNIFICAR GRUPO A (ETAPA 4 + 5 + 5.1-5.5):');
  console.log('   ✅ Vantagens:');
  console.log('      • Reduz de 7 passagens para 1 passagem sobre os dados');
  console.log('      • Melhor performance (menos I/O de arquivos)');
  console.log('      • Código mais simples e manutenível');
  console.log('      • Resultado final idêntico (filtros independentes)');
  console.log('   ⚠️  Considerações:');
  console.log('      • Manter a estrutura modular para facilitar debug');
  console.log('      • Executar todos os critérios em uma única função');
  console.log('      • Manter logs detalhados por critério');
  console.log('');
  
  console.log('2. MANTER ETAPA 5.6 SEPARADA:');
  console.log('   ✅ Motivo:');
  console.log('      • Requer análise de distância entre POIs');
  console.log('      • Deve ser executada após todos os filtros');
  console.log('      • Algoritmo diferente (não é apenas filtro por critério)');
  console.log('');
  
  console.log('3. UNIFICAR ETAPA 5.7 COM GRUPO A:');
  console.log('   ✅ Motivo:');
  console.log('      • Também filtra por critério de valor turístico');
  console.log('      • Pode ser executada junto com outros filtros de nome');
  console.log('      • Mas deve ser executada ANTES da deduplicação (ETAPA 5.6)');
  console.log('');
  
  console.log('4. ESTRUTURA PROPOSTA:');
  console.log('   • ETAPA 1: Filtro base (manter)');
  console.log('   • ETAPA 2: Filtro de acesso (manter)');
  console.log('   • ETAPA 3: Refinamento por categoria (manter)');
  console.log('   • ETAPA 4-5.7 UNIFICADA: Filtros de valor turístico (unificar)');
  console.log('   • ETAPA 5.6: Deduplicação (manter separada)');
  console.log('');
  
  console.log('='.repeat(80));
  console.log('📊 IMPACTO DA UNIFICAÇÃO');
  console.log('='.repeat(80));
  console.log('');
  
  const fasesAtuais = fases.length;
  const fasesUnificadas = fases.filter(f => !f.podeUnificar || f.nome === 'ETAPA 5.6').length;
  const reducao = fasesAtuais - fasesUnificadas;
  
  console.log(`Fases atuais: ${fasesAtuais}`);
  console.log(`Fases após unificação: ${fasesUnificadas}`);
  console.log(`Redução: ${reducao} fases (${((reducao / fasesAtuais) * 100).toFixed(1)}%)`);
  console.log('');
  console.log('✅ Benefícios:');
  console.log(`   • Menos arquivos intermediários (${reducao} arquivos a menos)`);
  console.log(`   • Menos operações de I/O (${reducao} leituras/escritas a menos)`);
  console.log('   • Processamento mais rápido');
  console.log('   • Código mais simples');
  console.log('   • Resultado final idêntico');
}

if (import.meta.main) {
  analisarUnificacao();
}

