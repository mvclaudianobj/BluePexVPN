# Skill: extraneti-task-manager

**Arquivo:** `.markscode/skills/extraneti-task-manager.sh`
**Versão:** 1.0.0
**Criado:** 2026-08-04

## Descrição
Gerenciamento automático de tarefas no sistema Work360 (extraneti.com.br).
Permite que o agente Marks adicione comentários de execução, crie e gerencie checklists,
marque itens como concluídos e atualize status — tudo sem intervenção manual.

## Comandos

| Comando | Descrição |
|---|---|
| `login` | Autentica e salva sessão em cookie |
| `comment <task_id> <html>` | Adiciona comentário HTML na tarefa |
| `comment-md <task_id> <texto>` | Adiciona comentário (texto simples → `<p>`) |
| `checklist-create <nome> [cat_id]` | Cria checklist template (cat 41=UTM) |
| `checklist-add-items <cl_id> <i1>\|<i2>` | Adiciona itens separados por `\|` |
| `checklist-link <task_id> <cl_id>` | Associa checklist à tarefa |
| `checklist-check <task_id> <item_id> done\|undone` | Marca item como feito/desfeito |
| `load-checklists <task_id>` | Lista checklists e itens da tarefa |
| `load-comments <task_id>` | Lista comentários da tarefa |
| `status <task_id> <status_id>` | Atualiza status (1=Aberta,2=Andamento,3=Concluída) |
| `info <task_id>` | Exibe título e status da tarefa |

## Variáveis de ambiente

```bash
EXTRANETI_USER=marcos.claudiano
EXTRANETI_PASS=Kenosis7!@#
EXTRANETI_BASE=https://extraneti.com.br
EXTRANETI_DOMAIN=2/0f26e0b5893aa17fc63588b9ac43ef0d
EXTRANETI_COOKIES=/tmp/markscode/extraneti-session.txt
```

## Exemplos de uso

```bash
# Login
.markscode/skills/extraneti-task-manager.sh login

# Adicionar comentário de execução
.markscode/skills/extraneti-task-manager.sh comment 10009 \
  "<p><strong>[Marks]</strong> Rebase concluído sobre bluepex/utm_latest (a8132ae2f). 3 commits limpos.</p>"

# Criar checklist para tarefa
CL_ID=$(.markscode/skills/extraneti-task-manager.sh checklist-create "Rebase cpack 9924-9905 → 3.8.0" 41 | grep -o '[0-9]*$')

# Adicionar itens
.markscode/skills/extraneti-task-manager.sh checklist-add-items "$CL_ID" \
  "Identificar commits exclusivos vs utm_latest|Criar branch v2 sobre utm_latest|Resolver conflitos ovpn_auth_verify_unificado.sh|Resolver conflitos openvpn-client-export.inc|Regenerar cpack com generate_patches_version|Publicar no WSUTM|Abrir PR no Bluepex/utm_versions_packs"

# Associar checklist à tarefa
.markscode/skills/extraneti-task-manager.sh checklist-link 10009 "$CL_ID"

# Marcar item como feito (após executar etapa)
.markscode/skills/extraneti-task-manager.sh checklist-check 10009 <item_id> done
```

## Fluxo recomendado pelo agente Marks

1. **Início da tarefa:** `login` + `comment` com diagnóstico inicial + `checklist-create` + `checklist-add-items` + `checklist-link`
2. **Após cada etapa:** `checklist-check <item_id> done` + `comment` com resultado
3. **Conclusão:** `comment` com resumo final + `status 3` (Concluída)

## Endpoints mapeados (Work360)

```
POST /admin-area/tasks-management/tasks/comment/{task_id}
POST /admin-area/tasks-management/tasks/save-form
POST /admin-area/tasks-management/tasks/update-checklists-status/{task_id}
POST /admin-area/tasks-management/tasks/load-checklists-modal
POST /admin-area/tasks-management/tasks/load-comments-modal
POST /admin-area/checklists/save
GET  /admin-area/checklists/create
GET  /admin-area/checklists/edit/{id}
```
