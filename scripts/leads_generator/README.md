# Florida Transfer Leads Generator

Este script automatiza a busca de leads públicos (motoristas e transfers brasileiros) na Flórida utilizando a Google Custom Search API.

## Pré-requisitos

1. **Google API Key**: Crie uma chave de API no [Google Cloud Console](https://console.cloud.google.com/).
2. **Search Engine ID (CX)**: Crie um buscador customizado no [Programmable Search Engine](https://cse.google.com/cse/all).
   - **Importante**: Nas configurações do seu buscador, ative a opção "Buscar em toda a Web" (Search the entire web).

## Instalação

```bash
cd scripts/leads_generator
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Configuração

1. Copie o arquivo `.env.example` para `.env`:
   ```bash
   cp .env.example .env
   ```
2. Edite o `.env` com suas credenciais do Google.

## Uso

Execute o script:
```bash
python3 lead_generator.py
```

O resultado será salvo em `leads_florida_transfers.csv` ordenado pelo score de relevância.

## Lógica de Scoring

- `+3`: Se encontrar menção a WhatsApp/Link wa.me.
- `+2`: Se encontrar um padrão de telefone.
- `+2`: Se o termo "transfer" ou "traslado" estiver presente.
- `+2`: Se o termo "motorista" estiver presente.
- `+1`: Se mencionar Orlando.
- `+1`: Se mencionar Miami.
- `-2`: Se parecer uma vaga de emprego, notícia ou anúncio de venda.
