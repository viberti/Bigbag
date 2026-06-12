#!/usr/bin/env bash
# BACKUP da BD app_bigbag (revisão de metodologia 2026-06-12 — era a lacuna nº1:
# meses de talões reais sem backup; os e2e correm contra esta BD).
# Corre NO SERVIDOR como user dev (cron diário 04:10 + à mão antes de migrações
# arriscadas). Retenção 14 dias. Valida o dump (gzip -t + marcador final do
# mysqldump) — backup que não valida é apagado e o erro fica no log.
#   uso:  bash /home/dev/bigbag/scripts/backup_db.sh
#   restaurar (runbook): gunzip < FICHEIRO | mysql -u$DB_USER -p... app_bigbag
set -euo pipefail
ENV=/home/dev/bigbag/backend/.env
DIR=/home/dev/backups/bigbag
set -a; source "$ENV"; set +a
mkdir -p "$DIR"; chmod 700 "$DIR"

F="$DIR/app_bigbag_$(date +%Y%m%d_%H%M%S).sql.gz"
# MYSQL_PWD evita a password no ps; --single-transaction = dump consistente sem locks (InnoDB)
MYSQL_PWD="$DB_PASSWORD" mysqldump -u "$DB_USER" -h "${DB_HOST:-127.0.0.1}" \
  --single-transaction --quick --routines --triggers "$DB_NAME" | gzip > "$F"
chmod 600 "$F"

# validação: gzip íntegro E o mysqldump terminou ("Dump completed" no fim)
if ! gunzip -t "$F" || ! gunzip -c "$F" | tail -1 | grep -q "Dump completed"; then
  echo "ERRO: backup inválido — removido: $F" >&2
  rm -f "$F"
  exit 1
fi

# retenção: 14 dias
find "$DIR" -name 'app_bigbag_*.sql.gz' -mtime +14 -delete
echo "backup OK: $F ($(du -h "$F" | cut -f1)) · $(ls "$DIR" | wc -l) na retenção"
