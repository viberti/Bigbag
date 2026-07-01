#!/usr/bin/env bash
# ROLLBACK do deploy. Modelo PUSH (netcup, desde 2026-07-01): reenvia a árvore de uma
# ref (tag/commit) do PC para o servidor e espelha — igual ao deploy.sh, mas de um ref
# antigo. NÃO reescreve história (a ref de origem fica intacta). Migrações NÃO fazem
# rollback: são aditivas por regra (CLAUDE.md) — código antigo convive com colunas novas.
#   uso:  bash scripts/rollback.sh v0.0.133.0        (ou um hash)
#         bash scripts/rollback.sh v0.0.133.0 -f     (também rebuild do frontend)
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=netcup-prod
DEST=/home/dev/bigbag
REF="${1:?uso: rollback.sh <tag|commit> [-f]}"
FRONT=0; [[ "${2:-}" == "-f" ]] && FRONT=1

git rev-parse -q --verify "$REF^{commit}" >/dev/null || { echo "ref '$REF' não existe no repo local (git fetch --tags?)." >&2; exit 1; }

read -r -p "Rollback do SERVIDOR para '$REF'${FRONT:+ (com rebuild do frontend)}. Confirmas? [s/N] " ok
[[ "$ok" == "s" || "$ok" == "S" ]] || { echo "cancelado."; exit 1; }

STAGE="$(dirname "$DEST")/.bigbag-stage"   # staging FORA de $DEST (senão o --delete auto-apaga-se)
echo "a enviar $REF ($(git rev-parse --short "$REF")) para $HOST:$DEST …"
ssh "$HOST" "sudo -u dev rm -rf $STAGE && sudo -u dev mkdir -p $STAGE"
git archive --format=tar "$REF" | ssh "$HOST" "sudo -u dev tar -x -C $STAGE"
ssh "$HOST" "set -e
  sudo -u dev rsync -a --delete \
    --exclude='.env' --exclude='.env.*' --exclude='node_modules/' \
    --exclude='/frontend/dist' --exclude='/frontend/dist.bak-*' \
    --exclude='/backend/uploads' --exclude='/logs' --exclude='/bigbag.db' \
    --exclude='/Notas pessoais' \
    $STAGE/ $DEST/
  sudo -u dev rm -rf $STAGE
  sudo -u dev npm --prefix $DEST/backend install --no-audit --no-fund -s
  if [ $FRONT -eq 1 ]; then
    (cd $DEST/frontend && sudo -u dev npm run build -s >/dev/null && echo 'frontend BUILT')
  fi
  sudo systemctl restart bigbag-backend
  for i in 1 2 3 4 5 6; do sleep 2
    h=\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4200/health)
    if [ \"\$h\" = '200' ]; then echo \"health OK — servidor em $REF\"; exit 0; fi
  done
  echo 'ERRO: /health não respondeu — ver journalctl -u bigbag-backend' >&2; exit 1"
echo "NOTA: o próximo deploy normal (deploy.sh) volta a pôr o servidor no topo do ramo."
