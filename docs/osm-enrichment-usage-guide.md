# Guia de Uso: Enriquecimento OSM de POIs

## 📋 Visão Geral

A funcionalidade de **Enriquecimento OSM** permite enriquecer automaticamente os POIs do banco de dados com informações detalhadas do OpenStreetMap (OSM). Esta funcionalidade adiciona dados como:

- **Informações patrimoniais** (UNESCO, heritage status)
- **Dados de acessibilidade** (wheelchair access, parking)
- **Scores de qualidade** para geração de POVs
- **Características culturais** e arquitetônicas
- **Dados ambientais** e urbanos

## 🚀 Como Acessar

1. Acesse o CMS do Tuggi
2. No menu lateral, clique em **"Enrich OSM"**
3. A página estará disponível em: `/verification/enrich-osm`

## 📊 Interface da Página

### Painel de Parâmetros (Lado Esquerdo)

#### **País**
- Selecione o país dos POIs que deseja enriquecer
- Opções disponíveis: Brazil, Spain, United States, Ireland, Mexico, Argentina, Chile, Colombia, Peru

#### **Cidade (Opcional)**
- Deixe vazio para buscar em todas as cidades do país
- Digite o nome da cidade para filtrar POIs específicos

#### **Tipo de Enriquecimento**
- **All POIs**: Todos os POIs aprovados
- **No OSM Data**: POIs sem dados OSM
- **Low Quality**: POIs com qualidade OSM < 70%
- **No Heritage**: POIs sem status patrimonial
- **No POV Scores**: POIs sem scores de POV

#### **Limit**
- Número máximo de POIs para buscar (1-1000)
- Recomendado: 50-100 para testes

#### **Delay Between Calls**
- Delay entre chamadas da API (em milissegundos)
- **Recomendado: 2000ms** para evitar rate limits
- Mínimo: 0ms, Máximo: 10000ms

### Lista de POIs (Lado Direito)

#### **Status de Enriquecimento**
- 🔴 **No OSM Data**: POI sem dados OSM
- 🟡 **Low Quality**: Dados OSM de baixa qualidade
- 🔵 **Partial Data**: Dados OSM parciais
- 🟢 **Complete**: Dados OSM completos

#### **Informações Exibidas**
- Nome do POI
- Cidade e país
- Categoria OSM (se disponível)
- Score de qualidade (se disponível)
- Status patrimonial (se disponível)

## 🔄 Processo de Enriquecimento

### 1. **Buscar POIs**
1. Configure os parâmetros desejados
2. Clique em **"Search POIs"**
3. Aguarde a busca ser concluída

### 2. **Selecionar POIs**
1. Use **"Select All"** para selecionar todos
2. Ou selecione POIs individuais clicando nos checkboxes
3. Use **"Clear"** para limpar a seleção

### 3. **Executar Enriquecimento**
1. Clique em **"Enrich X Selected"**
2. Acompanhe o progresso na barra de progresso
3. Aguarde a conclusão do processo

### 4. **Resultados**
- ✅ **Sucesso**: POI enriquecido com sucesso
- ❌ **Erro**: Falha no enriquecimento (ver logs)

## 📈 Campos Adicionados

### **Dados OSM Básicos**
- `osm_category`: Categoria OSM (tourism, amenity, historic)
- `osm_tags`: Tags OSM completas (JSONB)
- `osm_data_quality_score`: Score de qualidade (0-100)
- `osm_geometry`: Geometria OSM (PostGIS)
- `osm_last_updated`: Data da última atualização

### **Dados Patrimoniais**
- `heritage_status`: Status do patrimônio
- `unesco_status`: Status UNESCO
- `landmark_level`: Nível de landmark (1-10)
- `architect`: Arquiteto/designer
- `architectural_style`: Estilo arquitetônico

### **Scores para POVs**
- `pov_quality_score`: Score para geração de POVs
- `visibility_score`: Score de visibilidade
- `accessibility_score`: Score de acessibilidade
- `photogenic_score`: Score fotográfico

### **Acessibilidade**
- `wheelchair_accessible`: Acesso para cadeirantes
- `parking_capacity`: Capacidade de estacionamento
- `public_transport`: Transporte público disponível

### **Dados Culturais**
- `cultural_significance`: Significado cultural
- `local_traditions`: Tradições locais
- `seasonal_attractions`: Atrações sazonais

## ⚠️ Considerações Importantes

### **Rate Limiting**
- OSM APIs têm limites de requisições
- **Recomendado**: 2 segundos entre chamadas
- Evite processar muitos POIs simultaneamente

### **Qualidade dos Dados**
- Dados OSM variam em qualidade por região
- POIs internacionais geralmente têm dados melhores
- POIs menores podem ter dados limitados

### **Performance**
- Processamento em lote pode ser lento
- Monitore o progresso na barra de progresso
- Interrompa se necessário (refresh da página)

## 🧪 Testando a Funcionalidade

### **Script de Teste**
Execute o script de teste para verificar a API:

```bash
npx tsx scripts/test-osm-enrichment-api.ts
```

### **Teste Manual**
1. Selecione um país com POIs conhecidos (ex: Brazil)
2. Escolha uma cidade específica (ex: São Paulo)
3. Selecione "No OSM Data" para POIs sem dados
4. Processe 1-2 POIs para teste
5. Verifique os resultados

## 📊 Monitoramento

### **Logs do Console**
- Abra o DevTools (F12)
- Acompanhe os logs no console
- Verifique erros e warnings

### **Métricas de Sucesso**
- **Score de qualidade**: 70%+ é considerado bom
- **Campos atualizados**: Mais campos = mais dados
- **Taxa de sucesso**: % de POIs enriquecidos com sucesso

## 🔧 Solução de Problemas

### **Erro 429 (Too Many Requests)**
- Aumente o delay entre chamadas
- Reduza o número de POIs processados
- Aguarde alguns minutos antes de tentar novamente

### **Erro 500 (Internal Server Error)**
- Verifique os logs do servidor
- Verifique a conectividade com APIs OSM
- Tente com um POI diferente

### **Dados Não Encontrados**
- POI pode não existir no OSM
- Nome pode estar diferente
- Tente variações do nome

### **Qualidade Baixa**
- Dados OSM podem ser limitados para o POI
- Considere enriquecimento manual
- Verifique se o POI é conhecido internacionalmente

## 📚 Próximos Passos

### **Após o Enriquecimento**
1. **Verificar dados**: Confirme se os dados foram salvos corretamente
2. **Aprovar POIs**: POIs enriquecidos podem ser aprovados
3. **Gerar POVs**: Use os scores para gerar POVs otimizados
4. **Monitorar qualidade**: Acompanhe a qualidade dos dados ao longo do tempo

### **Manutenção**
- Execute enriquecimento periodicamente
- Monitore a qualidade dos dados
- Atualize POIs com dados desatualizados

## 🎯 Dicas de Uso

### **Para Melhores Resultados**
1. **Comece pequeno**: Teste com poucos POIs primeiro
2. **Use cidades específicas**: Filtre por cidade para melhor precisão
3. **Monitore a qualidade**: Verifique os scores de qualidade
4. **Processe em lotes**: Enriqueça POIs por região/cidade

### **Estratégias por Tipo de POI**
- **Monumentos internacionais**: Geralmente têm dados excelentes
- **Parques urbanos**: Dados muito ricos, muitos elementos
- **Museus grandes**: Dados oficiais e detalhados
- **POIs menores**: Dados básicos mas autênticos

### **Otimização de Performance**
- Use delays apropriados (2000ms)
- Processe em horários de baixo tráfego
- Monitore o uso de recursos
- Faça backup antes de processamentos grandes

## 📞 Suporte

Se encontrar problemas:
1. Verifique os logs do console
2. Teste com um POI diferente
3. Verifique a conectividade com APIs OSM
4. Consulte a documentação técnica
5. Entre em contato com a equipe de desenvolvimento
