-- Fase 4 (Estoque): lote e validade, inventário (contagem) e pedido de compra. Migração apenas ADITIVA:
-- nenhum produto, movimentação ou saldo existente é alterado.
ALTER TABLE products ADD COLUMN tracks_batches BOOLEAN NOT NULL DEFAULT false;

-- Lotes: o saldo do produto continua em products.quantity (fonte da verdade); os lotes detalham de onde ele vem.
CREATE TABLE stock_batches (
  id         BIGSERIAL PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id),
  code       TEXT NOT NULL,
  expires_at DATE,
  quantity   NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, code)
);
CREATE INDEX stock_batches_expiry_idx ON stock_batches (expires_at) WHERE quantity > 0;

-- De quais lotes cada movimentação tirou ou colocou (uma saída pode consumir vários lotes).
CREATE TABLE stock_movement_batches (
  movement_id BIGINT NOT NULL REFERENCES stock_movements(id),
  batch_id    BIGINT NOT NULL REFERENCES stock_batches(id),
  delta       NUMERIC(14,3) NOT NULL,
  PRIMARY KEY (movement_id, batch_id)
);

-- Inventário: contagem física com ajuste ao finalizar.
CREATE TABLE stock_counts (
  id               SERIAL PRIMARY KEY,
  title            TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','finalizado','cancelado')),
  category_id      INT REFERENCES product_categories(id),
  notes            TEXT,
  created_by       UUID,
  created_by_name  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at     TIMESTAMPTZ,
  finalized_by_name TEXT
);
CREATE TABLE stock_count_items (
  id           BIGSERIAL PRIMARY KEY,
  count_id     INT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id),
  batch_id     BIGINT REFERENCES stock_batches(id),
  system_qty   NUMERIC(14,3) NOT NULL,                 -- saldo no momento em que a contagem foi aberta
  counted_qty  NUMERIC(14,3) CHECK (counted_qty IS NULL OR counted_qty >= 0),
  note         TEXT,
  counted_by_name TEXT,
  counted_at   TIMESTAMPTZ,
  applied_delta NUMERIC(14,3),                         -- diferença efetivamente ajustada ao finalizar
  movement_id  BIGINT REFERENCES stock_movements(id)
);
CREATE UNIQUE INDEX stock_count_items_uq ON stock_count_items (count_id, product_id, COALESCE(batch_id, 0));

-- Pedido de compra: fornecedor (cadastro único), itens, recebimentos e conta a pagar gerada.
CREATE TABLE purchase_orders (
  id            SERIAL PRIMARY KEY,
  number        TEXT UNIQUE,
  party_id      INT NOT NULL REFERENCES parties(id),
  status        TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','enviado','parcial','recebido','encerrado','cancelado')),
  order_date    DATE NOT NULL,
  expected_date DATE,
  notes         TEXT,
  created_by    UUID,
  created_by_name TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE purchase_order_items (
  id           SERIAL PRIMARY KEY,
  order_id     INT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id),
  quantity     NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost    NUMERIC(14,4) NOT NULL CHECK (unit_cost >= 0),
  received_qty NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  UNIQUE (order_id, product_id)
);
CREATE TABLE purchase_receipts (
  id             SERIAL PRIMARY KEY,
  order_id       INT NOT NULL REFERENCES purchase_orders(id),
  received_at    DATE NOT NULL,
  doc_number     TEXT,
  total          NUMERIC(14,2) NOT NULL,
  transaction_id UUID REFERENCES financial_transactions(id),   -- conta a pagar gerada (opcional)
  created_by_name TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE purchase_receipt_items (
  receipt_id  INT NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  item_id     INT NOT NULL REFERENCES purchase_order_items(id),
  quantity    NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost   NUMERIC(14,4) NOT NULL,
  batch_code  TEXT,
  expires_at  DATE,
  PRIMARY KEY (receipt_id, item_id)
);

INSERT INTO settings (key, value) VALUES ('notify_batches_enabled', 'true'::jsonb), ('batch_alert_days', '30'::jsonb) ON CONFLICT (key) DO NOTHING;
