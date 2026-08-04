#!/bin/bash
# =============================================================================
# SKILL: extraneti-task-manager
# Descrição: Gerenciamento automático de tarefas no Work360 (extraneti.com.br)
# Versão: 1.0.0
# Criado: 2026-08-04
# =============================================================================
# USAGE:
#   extraneti-task-manager <command> [args...]
#
# COMMANDS:
#   login                              - Autentica e salva sessão
#   comment <task_id> <mensagem>       - Adiciona comentário HTML numa tarefa
#   comment-md <task_id> <mensagem>    - Adiciona comentário em markdown (converte para HTML)
#   checklist-create <nome> <cat_id>   - Cria checklist template (retorna checklist_id)
#   checklist-add-items <cl_id> <item1>|<item2>|...  - Adiciona items a um checklist
#   checklist-link <task_id> <cl_id>   - Associa checklist a uma tarefa
#   checklist-check <task_id> <item_id> <done|undone> - Marca item como feito/desfeito
#   status <task_id> <status_id>       - Atualiza status da tarefa
#   info <task_id>                     - Exibe info básica da tarefa
#   load-checklists <task_id>          - Lista checklists e items de uma tarefa
#   load-comments <task_id>            - Lista comentários de uma tarefa
#
# STATUS IDs conhecidos (BluePex Controle):
#   1 = Aberta | 2 = Em andamento | 3 = Concluída | 4 = Cancelada | 5 = Bloqueada
#
# VARIÁVEIS DE AMBIENTE (opcionais, override do padrão):
#   EXTRANETI_USER     (padrão: marcos.claudiano)
#   EXTRANETI_PASS     (padrão: Kenosis7!@#)
#   EXTRANETI_BASE     (padrão: https://extraneti.com.br)
#   EXTRANETI_DOMAIN   (padrão: 2/0f26e0b5893aa17fc63588b9ac43ef0d)
#   EXTRANETI_COOKIES  (padrão: /tmp/markscode/extraneti-session.txt)
# =============================================================================

set -euo pipefail

BASE="${EXTRANETI_BASE:-https://extraneti.com.br}"
USER_LOGIN="${EXTRANETI_USER:-marcos.claudiano}"
USER_PASS="${EXTRANETI_PASS:-Kenosis7!@#}"
DOMAIN="${EXTRANETI_DOMAIN:-2/0f26e0b5893aa17fc63588b9ac43ef0d}"
COOKIES="${EXTRANETI_COOKIES:-/tmp/markscode/extraneti-session.txt}"
LOCK_FILE="/tmp/markscode/extraneti-login.lock"

mkdir -p /tmp/markscode

# ---------- helpers ----------------------------------------------------------

_csrf() {
  grep -o 'csrf_test_name.*value="[^"]*"' "$COOKIES" 2>/dev/null \
    | grep -o '"[^"]*"$' | tr -d '"' || true
}

_curl() {
  curl -s --connect-timeout 20 \
    -b "$COOKIES" -c "$COOKIES" \
    -H "X-Requested-With: XMLHttpRequest" \
    "$@"
}

_log() { echo "[extraneti-task] $*" >&2; }

# ---------- login ------------------------------------------------------------

do_login() {
  _log "Autenticando como $USER_LOGIN..."
  # Pega CSRF
  curl -s --connect-timeout 15 -c "$COOKIES" "$BASE/login" > /tmp/markscode/extraneti-login-page.html
  local CSRF
  CSRF=$(grep 'csrf_test_name' /tmp/markscode/extraneti-login-page.html | head -1 \
    | grep -o 'value="[^"]*"' | head -1 | cut -d'"' -f2)

  local PASS_ENC
  PASS_ENC=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$USER_PASS'))")

  local HTTP
  HTTP=$(curl -s --connect-timeout 15 \
    -b "$COOKIES" -c "$COOKIES" \
    -X POST "$BASE/login/authenticate" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -H "Referer: $BASE/login" \
    -d "login=$USER_LOGIN&password=$PASS_ENC&csrf_test_name=$CSRF" \
    -w "%{http_code}" -o /dev/null)

  if [ "$HTTP" != "303" ]; then
    _log "ERRO: Login falhou (HTTP $HTTP)"
    return 1
  fi

  # Seleciona domínio
  _curl -L "$BASE/app/set-domain/$DOMAIN" > /dev/null
  _log "Login OK. Domínio selecionado."
  echo "OK"
}

# Garante sessão válida (verifica se já autenticado)
_ensure_session() {
  local TEST
  TEST=$(_curl "$BASE/admin-area/tasks-management/tasks" -o /dev/null -w "%{http_code}" -L)
  if [ "$TEST" != "200" ]; then
    do_login > /dev/null
  fi
}

# ---------- comment ----------------------------------------------------------

do_comment() {
  local TASK_ID="$1"
  local MSG="$2"
  local TYPE="${3:-1}"         # 1=Público 2=Privado
  local CLASS_ID="${4:-}"      # classification_id (vazio = sem marcação)
  _ensure_session

  local CSRF
  CSRF=$(_curl "$BASE/admin-area/tasks-management/tasks/show/$TASK_ID" \
    | grep -o 'csrf_test_name" value="[^"]*"' | grep -o '"[^"]*"$' | tr -d '"')

  local RES
  RES=$(_curl -X POST "$BASE/admin-area/tasks-management/tasks/comment/$TASK_ID" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "csrf_test_name=$CSRF" \
    --data-urlencode "comment=$MSG" \
    --data-urlencode "type=$TYPE" \
    --data-urlencode "classification_id=$CLASS_ID")

  echo "$RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'), '-', d.get('msg',''))" 2>/dev/null || echo "$RES"
}

# ---------- checklist create -------------------------------------------------

do_checklist_create() {
  local NAME="$1"
  local CAT_ID="${2:-41}"  # 41 = UTM por padrão
  _ensure_session

  local CSRF
  CSRF=$(_curl "$BASE/admin-area/checklists/create" \
    | grep -o 'X-CSRF-TOKEN" content="[^"]*"' | cut -d'"' -f3)

  local NAME_ENC
  NAME_ENC=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$NAME'''))")

  local RES
  RES=$(_curl -X POST "$BASE/admin-area/checklists/save" \
    -H "X-CSRF-TOKEN: $CSRF" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "_token=$CSRF&form_action=create&checklist_category_id=$CAT_ID&name=$NAME_ENC&only_checklist=0")

  # Tenta extrair ID do redirect
  local CL_ID
  CL_ID=$(echo "$RES" | grep -o 'checklists/edit/[0-9]*' | grep -o '[0-9]*$' | head -1 || true)
  [ -n "$CL_ID" ] && echo "CHECKLIST_ID:$CL_ID" || echo "$RES"
}

# ---------- checklist add items ----------------------------------------------

do_checklist_add_items() {
  local CL_ID="$1"
  local ITEMS_STR="$2"  # separado por |
  _ensure_session

  local CSRF
  CSRF=$(_curl "$BASE/admin-area/checklists/edit/$CL_ID" \
    | grep -o 'X-CSRF-TOKEN" content="[^"]*"' | cut -d'"' -f3)

  local POST_DATA="_token=$CSRF&checklist_id=$CL_ID&form_action=update"
  local ORDER=0
  IFS='|' read -ra ITEMS <<< "$ITEMS_STR"
  for ITEM in "${ITEMS[@]}"; do
    local ITEM_ENC
    ITEM_ENC=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$ITEM'''))")
    POST_DATA="$POST_DATA&items[new_$ORDER][item]=$ITEM_ENC&items[new_$ORDER][id]=&items[new_$ORDER][order]=$ORDER&items[new_$ORDER][notes]="
    ORDER=$((ORDER + 1))
  done

  local RES
  RES=$(_curl -X POST "$BASE/admin-area/checklists/save" \
    -H "X-CSRF-TOKEN: $CSRF" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "$POST_DATA")

  echo "$RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'), d.get('msg',''))" 2>/dev/null \
    || echo "Items adicionados ao checklist $CL_ID"
}

# ---------- checklist link to task -------------------------------------------

do_checklist_link() {
  local TASK_ID="$1"
  local CL_ID="$2"
  _ensure_session

  local CSRF
  CSRF=$(_curl "$BASE/admin-area/tasks-management/tasks/show/$TASK_ID" \
    | grep -o 'csrf_test_name" value="[^"]*"' | grep -o '"[^"]*"$' | tr -d '"')

  local RES
  RES=$(_curl -X POST "$BASE/admin-area/tasks-management/tasks/update-checklists-status/$TASK_ID" \
    -H "X-CSRF-TOKEN: $CSRF" \
    -F "_token=$CSRF" \
    -F "checklists_ids[]=$CL_ID")

  echo "$RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'), '-', d.get('msg',''))" 2>/dev/null || echo "$RES"
}

# ---------- checklist check item ---------------------------------------------

do_checklist_check() {
  local TASK_ID="$1"
  local ATTACH_ID="$2"
  local ITEM_ID="$3"
  local STATE="${4:-done}"  # done | undone
  _ensure_session

  local CSRF
  CSRF=$(_curl "$BASE/admin-area/tasks-management/tasks/show/$TASK_ID" \
    | grep -o 'csrf_test_name" value="[^"]*"' | grep -o '"[^"]*"$' | tr -d '"')

  local CHECKED="0"
  [ "$STATE" = "done" ] && CHECKED="1"

  local RES
  RES=$(_curl -X POST "$BASE/admin-area/tasks-management/tasks/update-checklists-status/$TASK_ID" \
    -H "X-CSRF-TOKEN: $CSRF" \
    -F "_token=$CSRF" \
    -F "checklists_attachs_items[$ATTACH_ID][$ITEM_ID][checklist_attach_item_id]=" \
    -F "checklists_attachs_items[$ATTACH_ID][$ITEM_ID][checklist_item_id]=$ITEM_ID" \
    -F "checklists_attachs_items[$ATTACH_ID][$ITEM_ID][checklist_id]=$(cat /tmp/markscode/cl_attach_checklist_id 2>/dev/null || echo 62)" \
    -F "checklists_attachs_items[$ATTACH_ID][$ITEM_ID][done]=$CHECKED")

  echo "$RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'), '-', d.get('msg',''))" 2>/dev/null || echo "$RES"
}

# ---------- load checklists --------------------------------------------------

do_load_checklists() {
  local TASK_ID="$1"
  _ensure_session

  local CSRF
  CSRF=$(_curl "$BASE/admin-area/tasks-management/tasks/show/$TASK_ID" \
    | grep -o 'X-CSRF-TOKEN" content="[^"]*"' | cut -d'"' -f3)

  local RES
  RES=$(_curl -X POST "$BASE/admin-area/tasks-management/tasks/load-checklists-modal" \
    -H "X-CSRF-TOKEN: $CSRF" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "_token=$CSRF&task_id=$TASK_ID")

  echo "$RES" | grep -oE 'data-item-id="[0-9]+"[^>]*>[^<]+' | sed 's/data-item-id="//;s/"[^>]*>/ | /' || echo "$RES"
}

# ---------- load comments ----------------------------------------------------

do_load_comments() {
  local TASK_ID="$1"
  _ensure_session

  local CSRF
  CSRF=$(_curl "$BASE/admin-area/tasks-management/tasks/show/$TASK_ID" \
    | grep -o 'X-CSRF-TOKEN" content="[^"]*"' | cut -d'"' -f3)

  local RES
  RES=$(_curl -X POST "$BASE/admin-area/tasks-management/tasks/load-comments-modal" \
    -H "X-CSRF-TOKEN: $CSRF" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "_token=$CSRF&task_id=$TASK_ID")

  echo "$RES" | python3 -c "
import sys, re
html = sys.stdin.read()
comments = re.findall(r'<div class=[\"|\']comment-text[\"|\'][^>]*>(.*?)</div>', html, re.DOTALL)
for i, c in enumerate(comments, 1):
    text = re.sub(r'<[^>]+>', '', c).strip()
    print(f'[{i}] {text[:200]}')
" 2>/dev/null || echo "$RES"
}

# ---------- task info --------------------------------------------------------

do_info() {
  local TASK_ID="$1"
  _ensure_session

  local PAGE
  PAGE=$(_curl -L "$BASE/admin-area/tasks-management/tasks/show/$TASK_ID")

  python3 - <<PYEOF
import re
html = open('/dev/stdin').read() if False else """$(echo "$PAGE" | sed 's/"/\\"/g' | head -c 50000)"""
title  = re.search(r'<h[1-6][^>]*class="[^"]*task.title[^"]*"[^>]*>(.*?)</h', html, re.DOTALL)
status = re.search(r'<option[^>]*selected[^>]*>(.*?)</option>', html)
print("Título:", re.sub(r'<[^>]+>','',title.group(1)).strip() if title else "N/A")
print("Status:", re.sub(r'<[^>]+>','',status.group(1)).strip() if status else "N/A")
PYEOF
}

# ---------- update status ----------------------------------------------------

do_status() {
  local TASK_ID="$1"
  local STATUS_ID="$2"
  _ensure_session

  local PAGE CSRF POST_DATA
  PAGE=$(_curl "$BASE/admin-area/tasks-management/tasks/show/$TASK_ID")
  CSRF=$(echo "$PAGE" | grep -o 'X-CSRF-TOKEN" content="[^"]*"' | cut -d'"' -f3)
  POST_DATA=$(echo "$PAGE" | grep -oP 'id="taskForm".*' | python3 -c "
import sys, re
# extrai campos hidden
html = sys.stdin.read()
fields = re.findall(r'name=\"([^\"]+)\"[^>]*value=\"([^\"]*)\"', html)
print('&'.join(f'{k}={v}' for k,v in fields[:30]))
" 2>/dev/null || true)

  local RES
  RES=$(_curl -X POST "$BASE/admin-area/tasks-management/tasks/save-form" \
    -H "X-CSRF-TOKEN: $CSRF" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "_token=$CSRF&task_id=$TASK_ID&status_id=$STATUS_ID&$POST_DATA")

  echo "$RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'), d.get('msg',''))" 2>/dev/null || echo "$RES"
}

# ---------- dispatcher -------------------------------------------------------

CMD="${1:-help}"
shift || true

case "$CMD" in
  login)              do_login ;;
  comment)            do_comment "$1" "$2" ;;
  comment-md)         do_comment "$1" "<p>$2</p>" ;;
  checklist-create)   do_checklist_create "$@" ;;
  checklist-add-items) do_checklist_add_items "$@" ;;
  checklist-link)     do_checklist_link "$@" ;;
  checklist-check)    do_checklist_check "$@" ;;
  load-checklists)    do_load_checklists "$1" ;;
  load-comments)      do_load_comments "$1" ;;
  info)               do_info "$1" ;;
  status)             do_status "$1" "$2" ;;
  help|*)
    grep '^#' "$0" | grep -v '#!/' | sed 's/^# //' | head -30
    ;;
esac
