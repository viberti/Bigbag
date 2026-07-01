#!/usr/bin/env bash
# Deploy padrão do Bigbag. Modelo PUSH (netcup, desde 2026-07-01): o PC é a fonte de
# verdade; envia a árvore do commit (git archive) para o servidor e ESPELHA com rsync.
# O servidor NÃO precisa de ser um repo git nem de credenciais do GitHub — só recebe.
# (Antes: git pull no servidor + alias pitacos-prod, ambos mortos com o servidor antigo.)
# Uso, a partir da raiz do repo, DEPOIS de commit+push (mensagens são manuais):
#   bash scripts/deploy.sh        # só backend: envia + restart + health check
#   bash scripts/deploy.sh -f     # também rebuild do frontend no servidor
# O que faz: (1) node --check aos .js do backend alterados (apanha syntax errors ANTES
# de derrubar o serviço); (2) testes puros (GATE, inclui o golden da classificação);
# (3) confirma que não há commits por enviar; (4) tag da versão; (5) no servidor:
# recebe o tar do HEAD, rsync-mirror (preserva .env/uploads/dist/node_modules), npm
# install, build se -f, restart, espera /health.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=netcup-prod             # alias SSH do servidor (user root, Debian); ~/.ssh/config
DEST=/home/dev/bigbag        # árvore do projeto no servidor (dono: dev)
FRONT=0
[[ "${1:-}" == "-f" ]] && FRONT=1

# 0) bump da versão (só com -f — a versão é baked no build do frontend). Commita+push.
if [[ "$FRONT" == "1" ]]; then
  NEWVER=$(node -e "const f='frontend/package.json',fs=require('fs'),p=JSON.parse(fs.readFileSync(f));const a=String(p.version).split('.');a[a.length-1]=String((parseInt(a[a.length-1],10)||0)+1);p.version=a.join('.');fs.writeFileSync(f,JSON.stringify(p,null,2)+'\n');console.log(p.version)")
  if [[ -n "$(git status --porcelain frontend/package.json)" ]]; then
    git add frontend/package.json && git commit -q -m "Versão $NEWVER" && git push -q && echo "versão → $NEWVER"
  fi
fi

# 1) sanity local: sintaxe dos ficheiros backend tocados nos últimos commits
for f in $(git diff --name-only HEAD~3 2>/dev/null | grep '^backend/.*\.js$' || true); do
  [[ -f "$f" ]] && node --check "$f" && echo "check OK: $f"
done

# 1b) testes PUROS (sem BD — *.bd.test.mjs ficam de fora). Inclui o GOLDEN SET.
(cd backend && node --test $(ls test/*.test.mjs | grep -v '\.bd\.') > /tmp/bigbag_tests.out 2>&1) \
  || { echo "ERRO: testes puros falharam — deploy abortado:" >&2; grep -E "^not ok|esperado=|obtido=" /tmp/bigbag_tests.out | head -30 >&2; exit 1; }
echo "testes puros OK ($(grep -c '^ok ' /tmp/bigbag_tests.out 2>/dev/null || echo '?') passes)"

# 2) nada por enviar? (o push model envia o HEAD LOCAL; manter o GitHub como espelho)
if [[ -n "$(git status --porcelain)" ]]; then
  echo "AVISO: há alterações por commitar — vai ser enviado o HEAD (commitado)." >&2
fi
if [[ -n "$(git log origin/bootstrap-infra..HEAD --oneline 2>/dev/null)" ]]; then
  echo "ERRO: há commits locais por enviar (git push primeiro)." >&2
  exit 1
fi

# 2b) git tag da versão (alvo para scripts/rollback.sh). Push de tags é livre.
VER="v$(node -e "console.log(require('./frontend/package.json').version)")"
if ! git rev-parse -q --verify "refs/tags/$VER" >/dev/null; then
  git tag -a "$VER" -m "deploy $(date +%F)" && git push -q origin "$VER" && echo "tag $VER criada"
fi

# 3) servidor: recebe o tar do HEAD para uma staging e ESPELHA com rsync.
echo "a enviar HEAD ($(git rev-parse --short HEAD)) para $HOST:$DEST …"
ssh "$HOST" "sudo -u dev rm -rf $DEST/.deploy-stage && sudo -u dev mkdir -p $DEST/.deploy-stage"
git archive --format=tar HEAD | ssh "$HOST" "sudo -u dev tar -x -C $DEST/.deploy-stage"
# rsync-mirror: --delete apaga o que saiu do repo (ex.: auth/oidc.js), mas os excludes
# PRESERVAM os ficheiros de runtime que não vivem no git (.env, uploads, dist, node_modules).
ssh "$HOST" "set -e
  sudo -u dev rsync -a --delete \
    --exclude='.env' --exclude='.env.*' --exclude='node_modules/' \
    --exclude='/frontend/dist' --exclude='/frontend/dist.bak-*' \
    --exclude='/backend/uploads' --exclude='/logs' --exclude='/bigbag.db' \
    --exclude='/Notas pessoais' \
    $DEST/.deploy-stage/ $DEST/
  sudo -u dev rm -rf $DEST/.deploy-stage
  sudo -u dev npm --prefix $DEST/backend install --no-audit --no-fund -s
  if [ $FRONT -eq 1 ]; then
    sudo -u dev npm --prefix $DEST/frontend install --no-audit --no-fund -s
    (cd $DEST/frontend && sudo -u dev npm run build -s >/dev/null && echo 'frontend BUILT')
  fi
  sudo systemctl restart bigbag-backend
  for i in 1 2 3 4 5 6; do sleep 2
    h=\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4200/health)
    if [ \"\$h\" = '200' ]; then echo 'health OK — deploy concluído'; exit 0; fi
  done
  echo 'ERRO: /health não respondeu 200 — ver journalctl -u bigbag-backend' >&2; exit 1"
