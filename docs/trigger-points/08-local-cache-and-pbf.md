# 08 - Local Cache & PBF Indexing (Acceleration)

Esta seção descreve as estratégias de aceleração local para a geração de Trigger Points, focando em performance e resiliência contra falhas de APIs externas.

## 🚀 Motivação
A geração de Trigger Points em massa (batch) para milhares de POIs pode ser lenta devido à latência da API do Overpass e ao risco de *rate-limiting* (Erros 429/504). Para resolver isso, implementamos uma arquitetura de cache local e indexação de dados geográficos.

---

## 🏗️ Camadas de Aceleração

O sistema opera em uma cadeia de prioridades para busca de dados geográficos (Ruas e Prédios):

### 1. Camada Local (PBF Index)
- **Localização**: `data/local_osm.db` (SQLite)
- **Como funciona**: Extrai geometrias de arquivos `.osm.pbf` (Geofabrik) e as armazena com índices espaciais BBox.
- **Vantagem**: Consultas sub-milissegundo, 100% offline, zero dependência de rede.

### 2. Camada de Cache (Query Cache)
- **Localização**: `data/osm_cache.db` (SQLite)
- **Como funciona**: Armazena a resposta JSON completa de cada query enviada ao Overpass.
- **TTL**: 5 dias. Consultas idênticas dentro deste período retornam instantaneamente do disco.

### 3. Camada de Rede (Mirrors)
- **Como funciona**: Fallback final que rotaciona entre múltiplos mirrors do Overpass API.
- **Resultado**: O sucesso da consulta é persistido no Query Cache para usos futuros.

---

## 🛠️ Gerenciamento via CLI

Todas as operações são centralizadas no script `scripts/manage-osm.ts`.

### Comandos Disponíveis:

| Comando | Descrição |
|---------|-----------|
| `npx tsx scripts/manage-osm.ts --status` | Verifica se o índice local e cache estão ativos. |
| `npx tsx scripts/manage-osm.ts --import-pbf <file>` | Importa um arquivo PBF (requer `osmium`). |
| `npx tsx scripts/manage-osm.ts --cleanup [days]` | Remove cache de queries mais antigo que X dias. |
| `npx tsx scripts/manage-osm.ts --clear-cache` | Limpa todo o histórico de consultas salvas. |

---

## 📋 Como Acelerar uma Região Específica

Se você está processando POIs em uma região densa (ex: Flórida, São Paulo):

1.  Baixe o arquivo `.osm.pbf` da região no [Geofabrik](https://download.geofabrik.de/).
2.  Importe para o banco local:
    ```bash
    npx tsx scripts/manage-osm.ts --import-pbf florida-latest.osm.pbf
    ```
3.  O pipeline de Trigger Points automaticamente detectará que há dados locais para as coordenadas dos POIs e evitará qualquer chamada de rede.

---

## 🔧 Manutenção

- **Limpeza de Cache**: Recomendamos rodar `--cleanup 5` semanalmente para evitar que o arquivo `osm_cache.db` cresça excessivamente.
- **Dependências**: A importação de PBF depende da ferramenta `osmium` instalada no sistema operacional.
    - Mac: `brew install osmium-tool`
    - Linux: `sudo apt install osmium-tool`
