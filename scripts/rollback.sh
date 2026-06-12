#!/usr/bin/env bash
# ROLLBACK do deploy (revisão de metodologia 2026-06-12: reverter era improviso).
# Volta o CLONE DO SERVIDOR a uma ref (tag/commit), rebuild e restart — NÃO
# reescreve história partilhada (o reset é no working tree do deploy target;
# o repo de origem fica intacto). Migrações NÃO fazem rollback: são aditivas
# por regra (CLAUDE.md) — código antigo convive com colunas novas.
#   uso:  bash scripts/rollback.sh v0.0.133.0        (ou um hash)
#         bash scripts/rollback.sh v0.0.133.0 -f     (também rebuild do frontend)
set -euo pipefail
REF="${1:?uso: rollback.sh <tag|commit> [-f]}"
FRONT=0; [[ "${2:-}" == "-f" ]] && FRONT=1

read -r -p "Rollback do SERVIDOR para '$REF'${FRONT:+ (com rebuild do frontend)}. Confirmas? [s/N] " ok
[[ "$ok" == "s" || "$ok" == "S" ]] || { echo "cancelado."; exit 1; }

ssh pitacos-prod "set -e
  cd /home/dev/bigbag
  sudo -u dev git fetch -q --tags origin
  sudo -u dev git reset --hard '$REF'
  if [[ $FRONT -eq 1 ]]; then cd frontend && sudo -u dev npm run build -s >/dev/null && echo 'frontend BUILT' && cd ..; fi
  sudo systemctl restart bigbag-backend
  for i in 1 2 3 4 5 6; do sleep 2
    h=\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4200/health)
    if [[ \"\$h\" == \"200\" ]]; then echo \"health OK — servidor em \$(sudo -u dev git rev-parse --short HEAD)\"; exit 0; fi
  done
  echo 'ERRO: /health não respondeu — ver journalctl -u bigbag-backend' >&2; exit 1"
echo "NOTA: o próximo deploy normal (deploy.sh) volta a pôr o servidor no topo do ramo."
