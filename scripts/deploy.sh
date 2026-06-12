#!/usr/bin/env bash
# Deploy padrão do Bigbag (ritual que fazíamos à mão; adotado 2026-06-12).
# Uso, a partir da raiz do repo, DEPOIS de commit+push (mensagens são manuais):
#   bash scripts/deploy.sh        # só backend: pull + restart + health check
#   bash scripts/deploy.sh -f     # também rebuild do frontend no servidor
# O que faz: (1) node --check aos .js do backend alterados vs origin (apanha
# syntax errors ANTES de derrubar o serviço — lição do backtick num comentário
# SQL que causou crash-loop); (2) confirma que não há commits por enviar;
# (3) no servidor: git pull, build do frontend se -f, restart, espera /health.
set -euo pipefail
cd "$(dirname "$0")/.."

FRONT=0
[[ "${1:-}" == "-f" ]] && FRONT=1

# 1) sanity local: sintaxe dos ficheiros backend tocados nos últimos commits
for f in $(git diff --name-only HEAD~3 2>/dev/null | grep '^backend/.*\.js$' || true); do
  [[ -f "$f" ]] && node --check "$f" && echo "check OK: $f"
done

# 1b) testes PUROS (sem BD — convenção: *.bd.test.mjs ficam de fora, correm no
# servidor). Inclui o GOLDEN SET da classificação: mudou o vocabulário sem
# regenerar o fixture → o deploy PARA aqui com o diff.
(cd backend && node --test $(ls test/*.test.mjs | grep -v '\.bd\.') > /tmp/bigbag_tests.out 2>&1) \
  || { echo "ERRO: testes puros falharam — deploy abortado:" >&2; grep -E "^not ok|esperado=|obtido=" /tmp/bigbag_tests.out | head -30 >&2; exit 1; }
echo "testes puros OK ($(grep -c '^ok ' /tmp/bigbag_tests.out 2>/dev/null || echo '?') passes)"

# 2) nada por commitar/enviar?
if [[ -n "$(git status --porcelain)" ]]; then
  echo "AVISO: há alterações por commitar — o servidor vai receber só o que está no origin." >&2
fi
if [[ -n "$(git log origin/bootstrap-infra..HEAD --oneline 2>/dev/null)" ]]; then
  echo "ERRO: há commits locais por enviar (git push primeiro)." >&2
  exit 1
fi

# 2b) git tag da versão (alvo para scripts/rollback.sh) — criada no deploy, não
# no commit, para etiquetar só o que chegou a produção. Push de tags é livre.
VER="v$(node -e "console.log(require('./frontend/package.json').version)")"
if ! git rev-parse -q --verify "refs/tags/$VER" >/dev/null; then
  git tag -a "$VER" -m "deploy $(date +%F)" && git push -q origin "$VER" && echo "tag $VER criada"
fi

# 3) servidor: pull (+build) + restart + health
ssh pitacos-prod "set -e
  cd /home/dev/bigbag && sudo -u dev git pull -q
  if [[ $FRONT -eq 1 ]]; then cd frontend && sudo -u dev npm run build -s >/dev/null && echo 'frontend BUILT' && cd ..; fi
  sudo systemctl restart bigbag-backend
  for i in 1 2 3 4 5 6; do sleep 2
    h=\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4200/health)
    if [[ \"\$h\" == \"200\" ]]; then echo 'health OK — deploy concluído'; exit 0; fi
  done
  echo 'ERRO: /health não respondeu 200 — ver journalctl -u bigbag-backend' >&2; exit 1"
