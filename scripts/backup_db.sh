#!/usr/bin/env bash
# BACKUP da BD app_bigbag (revisão de metodologia 2026-06-12 — era a lacuna nº1:
# meses de talões reais sem backup; os e2e correm contra esta BD).
# Corre NO SERVIDOR como user dev (cron diário 04:10 + à mão antes de migrações
# arriscadas). Retenção 14 dias. Valida o dump (gzip -t + marcador final do
# mysqldump) — backup que não valida é apagado e o erro fica no log.
#   uso:  bash /home/dev/bigbag/scripts/backup_db.sh
#   restaurar (runbook): gunzip < FICHEIRO | mysql -u$DB_USER -p... app_bigbag
set -euo pipefail
cd /   # o cwd herdado do sudo pode ser ilegível p/ o dev (matou a 1.ª corrida no find)
ENV=/home/dev/bigbag/backend/.env
DIR=/home/dev/backups/bigbag
set -a; source "$ENV"; set +a
mkdir -p "$DIR"; chmod 700 "$DIR"

F="$DIR/app_bigbag_$(date +%Y%m%d_%H%M%S).sql.gz"
trap 'rm -f "$F"' ERR   # falha a meio não deixa dump parcial na retenção
# MYSQL_PWD evita a password no ps; --single-transaction = dump consistente sem
# locks (InnoDB); --no-tablespaces: o MySQL 8 exige PROCESS global p/ tablespaces
# e o user bigbag é confinado a app_bigbag.* DE PROPÓSITO (isolamento do host).
MYSQL_PWD="$DB_PASSWORD" mysqldump -u "$DB_USER" -h "${DB_HOST:-127.0.0.1}" \
  --single-transaction --quick --no-tablespaces --routines --triggers "$DB_NAME" | gzip > "$F"
chmod 600 "$F"

# validação: gzip íntegro E o mysqldump terminou ("Dump completed" no fim)
if ! gunzip -t "$F" || ! gunzip -c "$F" | tail -1 | grep -q "Dump completed"; then
  echo "ERRO: backup inválido — removido: $F" >&2
  rm -f "$F"
  exit 1
fi

# retenção local: 14 dias
find "$DIR" -name 'app_bigbag_*.sql.gz' -mtime +14 -delete
echo "backup OK: $F ($(du -h "$F" | cut -f1)) · $(ls "$DIR" | wc -l) na retenção local"

# ── OFF-SITE (Cloudflare R2, 2026-06-13): o backup local vive no MESMO disco do
# servidor — não protege de morte do VPS. Encripta client-side (gpg simétrico,
# passphrase no .env E no doc privado do PC do dono — o R2 só vê blobs opacos)
# e envia por rclone. Gracioso: sem remote configurado, avisa e não falha (o
# backup local continua válido). Retenção remota: 90 dias.
RCLONE=/home/dev/bin/rclone
if [[ -n "${BACKUP_GPG_PASS:-}" ]] && "$RCLONE" listremotes 2>/dev/null | grep -q '^r2:'; then
  # TETO de gasto (pedido do dono, 2026-06-13): o R2 não tem hard-cap nativo —
  # este é o nosso: bucket >5 GB (metade do free tier) = NÃO envia mais (um bug
  # de dumps gigantes/loop fica no log, nunca na fatura). Uso projetado: ~0,85 GB.
  BYTES=$("$RCLONE" size r2:bigbag-backups/ --json 2>/dev/null | grep -o '"bytes":[0-9]*' | cut -d: -f2 || echo 0)
  if [[ "${BYTES:-0}" -gt 5368709120 ]]; then
    echo "TETO: bucket R2 com $((BYTES/1024/1024)) MB (>5 GB) — upload RECUSADO; investigar" >&2
    exit 0   # o backup local fica feito; só o off-site é travado
  fi
  G="$F.gpg"
  gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$BACKUP_GPG_PASS" -o "$G" "$F"
  "$RCLONE" copyto "$G" "r2:bigbag-backups/$(basename "$G")" --s3-no-check-bucket
  rm -f "$G"  # o .gpg local é só veículo; o claro fica na retenção local
  "$RCLONE" delete "r2:bigbag-backups/" --min-age 90d 2>/dev/null || true
  echo "off-site OK: r2:bigbag-backups/$(basename "$G") · $("$RCLONE" ls r2:bigbag-backups/ | wc -l) no R2"
else
  echo "off-site: remote r2 não configurado (rclone config) — só backup local"
fi
