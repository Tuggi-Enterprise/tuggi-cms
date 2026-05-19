# OSM Local Cache & PBF Indexing Guide

Este documento descreve a implementação do sistema de cache local e indexação de dados OSM (OpenStreetMap) para acelerar a geração de Trigger Points sem a necessidade de servidores externos ou Docker.

## 🚀 Objetivo
Reduzir a dependência da API pública do Overpass, evitar rate-limiting e acelerar o processamento batch de POIs utilizando dados locais persistentes.

---

## 🏗️ Arquitetura

O sistema utiliza duas camadas de dados locais baseadas em **SQLite** (via `better-sqlite3`):

1.  **Query Cache (`data/osm_cache.db`)**: 
    - Armazena a resposta completa de cada consulta feita ao Overpass.
    - Chaveada por um hash SHA-256 da query.
    - Evita chamadas repetidas para o mesmo POI ou mesma região durante reprocessamentos.
    - **Expiração Automática**: Dados com mais de 5 dias são ignorados e podem ser limpos via CLI.

2.  **Local Data Index (`data/local_osm.db`)**:
    - Armazena ruas e prédios extraídos de arquivos `.osm.pbf` ou GeoJSON.
    - Utiliza índices de Bounding Box (BBox) para buscas espaciais ultra-rápidas.
    - Quando disponível, substitui completamente a necessidade de consultar a rede para aquela região.

---

## 🛠️ Comandos de Gerenciamento

O gerenciamento é feito através do script `scripts/manage-osm.ts`.

### 1. Limpeza de Cache
Para manter o projeto leve, remova entradas antigas (padrão 5 dias):
```bash
npx tsx scripts/manage-osm.ts --cleanup 5
```

### 2. Importação de PBF Regional
Se você vai processar muitos POIs em uma região específica (ex: Massachusetts, São Paulo), importe o PBF da região para tornar o processo instantâneo:
```bash
npx tsx scripts/manage-osm.ts --import-pbf caminho/para/seu.pbf
```
*Nota: Requer `osmium-tool` instalado no sistema (`brew install osmium-tool` no Mac).*

### 3. Verificar Status
Veja se o índice local está ativo e com dados:
```bash
npx tsx scripts/manage-osm.ts --status
```

### 4. Limpeza Total do Cache
```bash
npx tsx scripts/manage-osm.ts --clear-cache
```

---

## 🔄 Fluxo de Decisão (Priority Chain)

Ao buscar dados geográficos para um POI, o sistema segue esta ordem:

1.  **Local Index**: Procura ruas/prédios no `local_osm.db` (importado via PBF). Se encontrar, usa esses dados e **não acessa a internet**.
2.  **Persistent Cache**: Se não houver dados locais, procura uma resposta idêntica no `osm_cache.db` que tenha menos de 5 dias.
3.  **Network Fallback**: Se ambos falharem, faz a requisição para os mirrors do Overpass API e salva o resultado no cache para usos futuros.

---

## 📁 Arquivos Criados/Modificados

- `lib/services/osm-cache-service.ts`: Lógica de persistência e TTL do cache de queries.
- `lib/services/osm-local-data-service.ts`: Lógica de indexação e busca espacial local.
- `scripts/manage-osm.ts`: Ferramenta CLI de gerenciamento.
- `lib/services/trigger-points-google/services/osm-data-fetcher.ts`: Integração com o fetcher consolidado.
- `lib/services/trigger-points-google/core/boundary-detector.ts`: Integração com o detector de limites/alturas.

---

## 💡 Dicas de Uso

- **Migrações Batch**: Sempre importe o PBF da região antes de rodar o `migrate-pois-batch.ts`. Isso evita 504 (Gateway Timeout) e 429 (Too Many Requests) das APIs públicas.
- **Espaço em Disco**: O cache de queries é comprimido em JSON. Mesmo assim, para milhares de POIs, o banco pode crescer. Use o `--cleanup` semanalmente.
- **Desenvolvimento Offline**: Com o PBF importado, você pode gerar Trigger Points sem conexão com a internet.
