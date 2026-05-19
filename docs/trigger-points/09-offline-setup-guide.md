# 🌍 Guia do Sistema de Topografia Offline (Tuggi CMS)

Este documento descreve como configurar, gerenciar e utilizar o sistema de dados geográficos 100% offline do Tuggi CMS. Este sistema elimina a dependência de APIs externas (Overpass/Google), permitindo processamento massivo e paralelo sem erros de rede (429/504).

---

## 🏗️ 1. Estrutura de Cache e Dados

O sistema utiliza dois tipos de cache offline principais localizados na raiz do projeto:

1.  **OSM Local DB (`data/local_osm.db`)**:
    *   Banco de dados SQLite (7.9GB+ dependendo da região).
    *   Contém geometrias de ruas, prédios, vegetação e barreiras.
2.  **SRTM Elevation Cache (`data/srtm-cache/`)**:
    *   Arquivos `.hgt` de 1 arc-second (resolução de ~30m).
    *   Usado para calcular inclinação, elevação de POIs e obstruções visuais.

---

## 📦 2. Pré-requisitos

Para importar novos dados, você deve ter a ferramenta **Osmium** instalada no sistema:

```bash
# MacOS
brew install osmium-tool

# Linux (Ubuntu/Debian)
sudo apt-get install osmium-tool
```

---

## 🛠️ 3. Passo a Passo: Configurando uma Nova Região

### Passo 3.1: Download dos Dados OSM
Baixe os arquivos `.osm.pbf` da região desejada no [Geofabrik](https://download.geofabrik.de/).

**Exemplos:**
*   **Massachusetts**: `wget https://download.geofabrik.de/north-america/us/massachusetts-latest.osm.pbf -P data/`
*   **Brasil**: `wget https://download.geofabrik.de/south-america/brazil-latest.osm.pbf -P data/`

### Passo 3.2: Importação para o Banco Local
Use o script de gerenciamento para filtrar e importar os dados. O script fará o streaming dos dados para o SQLite de forma eficiente.

```bash
# Comando de importação (demora alguns minutos dependendo do tamanho do PBF)
npx tsx scripts/manage-osm.ts --import-pbf data/massachusetts-latest.osm.pbf
```

### Passo 3.3: Verificar Status
Garanta que o banco foi populado corretamente:

```bash
npx tsx scripts/manage-osm.ts --status
```

---

## 🚀 4. Executando Migrações em Lote

Com o banco offline pronto, você pode rodar múltiplas instâncias do script de migração. O sistema usará automaticamente a **Estratégia 1 (Local)** antes de tentar qualquer chamada externa.

### Exemplo: Migração de Massachusetts (USA)
```bash
export $(grep -v '^#' .env | xargs) && npx tsx scripts/migrate-pois-batch.ts \
  --country "USA" \
  --state "Massachusetts" \
  --batch-size 50 \
  --mode "enrichment_migration_triggers" \
  --auto-approve true
```

### Parâmetros Recomendados:
*   `--batch-size`: Recomendado 25-50 por console.
*   `--mode`: `enrichment_migration_triggers` (completo com análise topográfica).
*   `--auto-approve`: `true` para automatizar a aprovação baseada em confiança.

---

## 🧹 5. Manutenção e Limpeza

O sistema gera caches temporários de consultas para acelerar re-execuções. É importante limpar periodicamente.

### Limpar Cache de Consultas (Older than X days)
```bash
# Limpa cache de mais de 7 dias
npx tsx scripts/manage-osm.ts --cleanup 7
```

### Limpar TUDO (Reset Total do Cache de Consultas)
```bash
npx tsx scripts/manage-osm.ts --clear-cache
```

### Limpar Logs e Resultados de Migração
```bash
rm migration-results-*.json
```

---

## 💡 Dicas de Performance

1.  **SSD é Essencial**: O banco SQLite de 8GB performa 10x melhor em discos SSD/NVMe devido às buscas espaciais aleatórias.
2.  **SRTM Dinâmico**: Você não precisa baixar arquivos SRTM manualmente. O sistema baixa o `.hgt` necessário na primeira vez que encontra uma coordenada nova e o salva para sempre em `data/srtm-cache/`.
3.  **Múltiplos Consoles**: Você pode abrir 5 a 10 abas do terminal e rodar o script de migração com estados/cidades diferentes simultaneamente. O `LocalOSMFetcher` gerencia a concorrência do SQLite automaticamente.

---

> [!IMPORTANT]
> **Segurança**: Nunca comite os arquivos `data/*.db` ou `data/*.pbf` para o Git. Eles já estão configurados no `.gitignore` para evitar o upload de gigabytes de dados binários.
