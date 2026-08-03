#!/usr/bin/env bash
# PreToolUse — barra operações destrutivas de banco ANTES de executarem.
#
#   deny → nunca é legítimo aqui (recria/apaga o banco inteiro)
#   ask  → pode ser legítimo, mas exige consentimento explícito
#
# Entra: JSON do hook em stdin. Sai: JSON de decisão, ou nada (= fluxo normal).
# Cobre tanto Bash (`supabase db reset`, psql) quanto MCP (`execute_sql`).

set -uo pipefail

payload="$(cat)"

tool="$(printf '%s' "$payload" | jq -r '.tool_name // ""')"

# Só olhamos campos que carregam comando/SQL. Não varremos o tool_input inteiro
# para não disparar em conteúdo de arquivo sendo escrito.
text="$(printf '%s' "$payload" | jq -r '
  [.tool_input.command?, .tool_input.query?, .tool_input.sql?]
  | map(select(type == "string")) | join(" ")
')"

lower="$(printf '%s' "$text" | tr '[:upper:]' '[:lower:]')"

emit() {
  jq -cn --arg d "$1" --arg r "$2" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: $d,
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

# ── Tier 0: tools destrutivas que NÃO recebem SQL ───────────────────────────
# Operam por ID, então a inspeção de conteúdo abaixo não as veria.
case "$tool" in
  *__reset_branch)
    emit deny "BLOQUEADO: reset_branch recria o branch do zero, descartando dados. Mesma classe de 'db reset'." ;;
  *__delete_branch)
    emit ask "delete_branch apaga o branch inteiro. Confirme antes de executar." ;;
  *__merge_branch)
    emit ask "merge_branch aplica o branch NA PRODUÇÃO. Confirme antes de executar." ;;
  *__rebase_branch)
    emit ask "rebase_branch reescreve migrations do branch. Confirme antes de executar." ;;
esac

[ -z "$text" ] && exit 0

# ── Tier 1: bloqueio absoluto ───────────────────────────────────────────────
if grep -qE 'supabase[[:space:]]+db[[:space:]]+reset' <<<"$lower"; then
  emit deny "BLOQUEADO: 'supabase db reset' recria o banco do zero. Se for mesmo necessário, rode você manualmente no terminal."
fi

if grep -qE 'drop[[:space:]]+(database|schema)\b' <<<"$lower"; then
  emit deny "BLOQUEADO: DROP DATABASE/SCHEMA. Gere o SQL e aplique manualmente no painel do Supabase."
fi

# ── Tier 2: exige consentimento explícito ───────────────────────────────────
if grep -qE 'drop[[:space:]]+(table|view|materialized|function|procedure|index|trigger|type|policy|role|publication|extension)\b' <<<"$lower"; then
  emit ask "DROP detectado. Confirme antes de executar."
fi

if grep -qE 'drop[[:space:]]+(column|constraint)\b' <<<"$lower"; then
  emit ask "ALTER ... DROP detectado — perda de estrutura/dados. Confirme antes de executar."
fi

if grep -qE '\btruncate\b' <<<"$lower"; then
  emit ask "TRUNCATE detectado — esvazia a tabela. Confirme antes de executar."
fi

if grep -qE 'delete[[:space:]]+from\b' <<<"$lower" && ! grep -qE '\bwhere\b' <<<"$lower"; then
  emit ask "DELETE FROM sem WHERE — apaga a tabela inteira. Confirme antes de executar."
fi

if grep -qE 'supabase[[:space:]]+db[[:space:]]+(push|remote[[:space:]]+commit)\b' <<<"$lower"; then
  emit ask "Aplica migrations direto no banco remoto. Confirme antes de executar."
fi

exit 0
