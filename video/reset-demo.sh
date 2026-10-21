#!/usr/bin/env bash
# Recria o banco de DEMONSTRAÇÃO (jane_demo), sobe a API de demo na porta 3003 e popula dados fictícios.
set -euo pipefail
cd "$(dirname "$0")"
DEMO_URL=postgres://jane:${DB_PASSWORD:-dev-local-only-123}@127.0.0.1:5439/jane_demo
kill $(lsof -ti :3003) 2>/dev/null || true; sleep 1
docker exec jane-db psql -U jane -d postgres -qc "DROP DATABASE IF EXISTS jane_demo WITH (FORCE)" -c "CREATE DATABASE jane_demo"
( cd ../server && DATABASE_URL=$DEMO_URL ADMIN_NAME="Mariana Costa" ADMIN_EMAIL=admin@gentis.demo ADMIN_PASSWORD=GentisDemo2026 npx tsx src/cli.ts create-admin )
( cd ../server && DATABASE_URL=$DEMO_URL PORT=3003 PG_DUMP_CMD="docker exec -i jane-db pg_dump -U jane -d jane_demo" BACKUP_DIR=./storage/demo-backups UPLOAD_DIR=./storage/demo-uploads nohup npx tsx src/index.ts > /tmp/gentis-api-demo.log 2>&1 & )
until curl -sf localhost:3003/api/health >/dev/null; do sleep 1; done
node seed-demo.mjs
