-- Fase 2: Assistente de IA. Migração apenas ADITIVA.
-- Acesso por usuário (definido pelo administrador). Sem linha = sem acesso; o perfil Administrador tem acesso total.
CREATE TABLE ai_user_access (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  finance    BOOLEAN NOT NULL DEFAULT false,
  stock      BOOLEAN NOT NULL DEFAULT false,
  hr         BOOLEAN NOT NULL DEFAULT false,
  hr_salary  BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_conversations_user_idx ON ai_conversations (user_id, updated_at DESC);

CREATE TABLE ai_messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  blocks          JSONB,            -- tabelas e gráficos exibidos na resposta
  tools           TEXT[],           -- ferramentas de consulta usadas
  model           TEXT,
  tokens_in       INT NOT NULL DEFAULT 0,
  tokens_out      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_conv_idx ON ai_messages (conversation_id, id);
CREATE INDEX ai_messages_created_idx ON ai_messages (created_at);
