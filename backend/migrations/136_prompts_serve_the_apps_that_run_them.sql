-- Prompt Management, finished: the tables an app needs to RUN a prompt, not
-- only to edit one.
--
-- 131 gave prompts a home, versions and a publish step. What it could not do
-- was tell a consuming app (Artwork Automation first) which model a version
-- runs on, let two prompts share one variable definition, test a version
-- properly, or record what a live run cost and produced. This adds those,
-- following the design the owner approved on 2026-09-15:
--
--   * providers and models are rows, not free text;
--   * variables live in one library and are linked to each version, with a
--     frozen copy taken at publish so editing the library cannot change what a
--     published version meant;
--   * versions gain a "testing" state, a plain sequence number, and a history
--     of who moved them;
--   * a test is test → input → run (the run carries its own output);
--   * every live run is logged with the exact prompt, tokens, cost and files.
--
-- Additive throughout. Nothing is dropped or renamed; the old per-version
-- prompt_variables table stays (its rows are carried into the library) so any
-- reader of it keeps working. Safe to re-run.

-- ── Providers and models ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ai_providers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_key  VARCHAR(60)  NOT NULL UNIQUE,
  name          VARCHAR(120) NOT NULL,
  base_url      TEXT,
  -- Where the credential is kept (an environment variable or settings key).
  -- Never the key itself.
  api_key_ref   VARCHAR(120),
  status        VARCHAR(20) NOT NULL DEFAULT 'active',
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_models (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id            UUID NOT NULL REFERENCES ai_providers(id) ON DELETE RESTRICT,
  model_key              VARCHAR(120) NOT NULL,
  display_name           VARCHAR(160) NOT NULL,
  supports_image_input   BOOLEAN NOT NULL DEFAULT FALSE,
  supports_image_output  BOOLEAN NOT NULL DEFAULT FALSE,
  supports_json_mode     BOOLEAN NOT NULL DEFAULT FALSE,
  context_window         INT,
  max_output_tokens      INT,
  -- Prices make a run's cost computable; left empty when a model is not billed
  -- per token (e.g. ChatGPT driven through its web app).
  input_price_per_1k     NUMERIC(12,6),
  output_price_per_1k    NUMERIC(12,6),
  status                 VARCHAR(20) NOT NULL DEFAULT 'active',
  deprecated_at          TIMESTAMPTZ,
  created_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, model_key)
);
CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON ai_models (provider_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_providers_status_check') THEN
    ALTER TABLE ai_providers ADD CONSTRAINT ai_providers_status_check CHECK (status IN ('active', 'disabled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_models_status_check') THEN
    ALTER TABLE ai_models ADD CONSTRAINT ai_models_status_check CHECK (status IN ('active', 'disabled'));
  END IF;
END $$;

INSERT INTO ai_providers (provider_key, name, base_url) VALUES
  ('openai', 'OpenAI', 'https://api.openai.com/v1'),
  ('flux',   'Flux',   NULL)
ON CONFLICT (provider_key) DO NOTHING;

-- Artwork Automation drives ChatGPT through the designer's own browser, so its
-- model is the web app, which takes and returns images and is not billed per token.
INSERT INTO ai_models (provider_id, model_key, display_name, supports_image_input, supports_image_output)
SELECT p.id, 'chatgpt-web', 'ChatGPT (web, via Artwork Agent)', TRUE, TRUE
  FROM ai_providers p WHERE p.provider_key = 'openai'
ON CONFLICT (provider_id, model_key) DO NOTHING;

-- Register every provider/model a version already names, so each setting can
-- point at a row.
INSERT INTO ai_providers (provider_key, name)
SELECT DISTINCT lower(regexp_replace(s.provider, '[^A-Za-z0-9]+', '_', 'g')), s.provider
  FROM prompt_model_settings s
 WHERE COALESCE(s.provider, '') <> ''
ON CONFLICT (provider_key) DO NOTHING;

INSERT INTO ai_models (provider_id, model_key, display_name)
SELECT DISTINCT p.id, s.model_name, s.model_name
  FROM prompt_model_settings s
  JOIN ai_providers p ON p.provider_key = lower(regexp_replace(s.provider, '[^A-Za-z0-9]+', '_', 'g'))
 WHERE COALESCE(s.model_name, '') <> ''
ON CONFLICT (provider_id, model_key) DO NOTHING;

ALTER TABLE prompt_model_settings ADD COLUMN IF NOT EXISTS model_id UUID REFERENCES ai_models(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_prompt_model_settings_model ON prompt_model_settings (model_id);

UPDATE prompt_model_settings s
   SET model_id = m.id
  FROM ai_models m
  JOIN ai_providers p ON p.id = m.provider_id
 WHERE s.model_id IS NULL
   AND p.provider_key = lower(regexp_replace(s.provider, '[^A-Za-z0-9]+', '_', 'g'))
   AND m.model_key = s.model_name;

-- ── Modules ───────────────────────────────────────────────────────────────────

ALTER TABLE prompt_modules ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE prompt_modules ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_modules_status_check') THEN
    ALTER TABLE prompt_modules ADD CONSTRAINT prompt_modules_status_check
      CHECK (status IN ('active', 'disabled', 'archived'));
  END IF;
END $$;

-- ── Versions: a testing state, a plain sequence, who published ───────────────

ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS version_seq INT;
UPDATE prompt_versions v
   SET version_seq = s.seq
  FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY prompt_id ORDER BY created_at, id) AS seq
          FROM prompt_versions) s
 WHERE s.id = v.id AND v.version_seq IS NULL;
ALTER TABLE prompt_versions ALTER COLUMN version_seq SET NOT NULL;
-- Versions are numbered 1, 2, 3. The label follows the sequence; nothing has
-- been published or run under the old "1.0.0" labels.
UPDATE prompt_versions SET version_number = version_seq::text WHERE version_number <> version_seq::text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_versions_seq ON prompt_versions (prompt_id, version_seq);

ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Widened, not changed: every existing status is still allowed.
ALTER TABLE prompt_versions DROP CONSTRAINT IF EXISTS prompt_versions_status_check;
ALTER TABLE prompt_versions ADD CONSTRAINT prompt_versions_status_check
  CHECK (status IN ('draft', 'testing', 'production', 'archived'));

CREATE TABLE IF NOT EXISTS prompt_version_history (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prompt_version_id UUID NOT NULL REFERENCES prompt_versions(id) ON DELETE CASCADE,
  from_status       VARCHAR(20),
  to_status         VARCHAR(20) NOT NULL,
  changed_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  note              TEXT,
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prompt_version_history_version ON prompt_version_history (prompt_version_id, changed_at);

-- ── Variables: one library, linked per version ───────────────────────────────

CREATE TABLE IF NOT EXISTS prompt_variables_library (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  variable_key     VARCHAR(80)  NOT NULL UNIQUE,
  name             VARCHAR(120) NOT NULL,
  type             VARCHAR(20)  NOT NULL DEFAULT 'Text',
  description      TEXT,
  default_value    TEXT,
  validation_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           VARCHAR(20) NOT NULL DEFAULT 'active',
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_variables_library_key_check') THEN
    ALTER TABLE prompt_variables_library ADD CONSTRAINT prompt_variables_library_key_check
      CHECK (variable_key ~ '^[A-Za-z0-9_]+$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_variables_library_type_check') THEN
    ALTER TABLE prompt_variables_library ADD CONSTRAINT prompt_variables_library_type_check
      CHECK (type IN ('Text','Image','Boolean','Enum','Number','Ratio','Color','Asset','Array','JSON'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_variables_library_status_check') THEN
    ALTER TABLE prompt_variables_library ADD CONSTRAINT prompt_variables_library_status_check
      CHECK (status IN ('active', 'disabled', 'archived'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS prompt_version_variables (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prompt_version_id UUID NOT NULL REFERENCES prompt_versions(id) ON DELETE CASCADE,
  variable_id       UUID NOT NULL REFERENCES prompt_variables_library(id) ON DELETE RESTRICT,
  required          BOOLEAN NOT NULL DEFAULT FALSE,
  -- This prompt's own default; overrides the library default when set.
  default_value     TEXT,
  -- Where the value comes from at run time — the runtime needs this to fill it.
  source            VARCHAR(40) NOT NULL DEFAULT 'Job / CRM',
  display_order     INT NOT NULL DEFAULT 0,
  description       TEXT,
  -- Frozen copy of the library row taken when the version is published.
  snapshot          JSONB,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (prompt_version_id, variable_id)
);
CREATE INDEX IF NOT EXISTS idx_prompt_version_variables_version ON prompt_version_variables (prompt_version_id, display_order);
CREATE INDEX IF NOT EXISTS idx_prompt_version_variables_variable ON prompt_version_variables (variable_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_version_variables_source_check') THEN
    ALTER TABLE prompt_version_variables ADD CONSTRAINT prompt_version_variables_source_check
      CHECK (source IN ('Job / CRM','Uploaded Asset','UI Selection','System','Previous Step','AI Output','Database'));
  END IF;
END $$;

-- Carry anything declared the old way into the library and the links.
INSERT INTO prompt_variables_library (variable_key, name, type, description, default_value, validation_rules)
SELECT DISTINCT ON (pv.variable_name)
       pv.variable_name, pv.variable_name, pv.type, pv.description, pv.default_value, pv.validation_rules
  FROM prompt_variables pv
 ORDER BY pv.variable_name, pv.created_at
ON CONFLICT (variable_key) DO NOTHING;

INSERT INTO prompt_version_variables (prompt_version_id, variable_id, required, default_value, source, display_order, description)
SELECT pv.prompt_version_id, l.id, pv.required, pv.default_value, pv.source, pv.sort_order, pv.description
  FROM prompt_variables pv
  JOIN prompt_variables_library l ON l.variable_key = pv.variable_name
ON CONFLICT (prompt_version_id, variable_id) DO NOTHING;

-- ── Tests: test → input → run ─────────────────────────────────────────────────

ALTER TABLE prompt_tests ADD COLUMN IF NOT EXISTS test_name       VARCHAR(160);
ALTER TABLE prompt_tests ADD COLUMN IF NOT EXISTS description     TEXT;
ALTER TABLE prompt_tests ADD COLUMN IF NOT EXISTS expected_output TEXT;
ALTER TABLE prompt_tests ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS prompt_test_inputs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  test_id     UUID NOT NULL REFERENCES prompt_tests(id) ON DELETE CASCADE,
  input_data  JSONB NOT NULL DEFAULT '{}'::jsonb,
  input_type  VARCHAR(10) NOT NULL DEFAULT 'json',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prompt_test_inputs_test ON prompt_test_inputs (test_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_test_inputs_type_check') THEN
    ALTER TABLE prompt_test_inputs ADD CONSTRAINT prompt_test_inputs_type_check CHECK (input_type IN ('text', 'image', 'json'));
  END IF;
END $$;

-- One execution. Its output lives on the same row: a run has exactly one.
CREATE TABLE IF NOT EXISTS prompt_test_runs (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  input_id                UUID NOT NULL REFERENCES prompt_test_inputs(id) ON DELETE CASCADE,
  prompt_version_id       UUID NOT NULL REFERENCES prompt_versions(id) ON DELETE CASCADE,
  prompt_model_setting_id UUID REFERENCES prompt_model_settings(id) ON DELETE SET NULL,
  model_id                UUID REFERENCES ai_models(id) ON DELETE SET NULL,
  -- The settings as they were when this ran; a draft's settings can change later.
  settings_snapshot       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The exact text sent, after every variable was filled in.
  resolved_prompt         TEXT,
  status                  VARCHAR(20) NOT NULL DEFAULT 'queued',
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  error_message           TEXT,
  output_data             JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_time_ms        INT,
  input_tokens            INT,
  output_tokens           INT,
  cost_usd                NUMERIC(12,6),
  quality_score           NUMERIC(5,2),
  scored_by               UUID REFERENCES users(id) ON DELETE SET NULL,
  score_notes             TEXT,
  created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prompt_test_runs_input ON prompt_test_runs (input_id);
CREATE INDEX IF NOT EXISTS idx_prompt_test_runs_version ON prompt_test_runs (prompt_version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_test_runs_model ON prompt_test_runs (model_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_test_runs_status_check') THEN
    -- "resolved": the prompt was filled in and recorded, but no model was called.
    ALTER TABLE prompt_test_runs ADD CONSTRAINT prompt_test_runs_status_check
      CHECK (status IN ('queued', 'running', 'success', 'failed', 'timeout', 'resolved'));
  END IF;
END $$;

-- ── Live runs ─────────────────────────────────────────────────────────────────

ALTER TABLE ai_generation_logs ADD COLUMN IF NOT EXISTS prompt_key    VARCHAR(120);
ALTER TABLE ai_generation_logs ADD COLUMN IF NOT EXISTS source_app    VARCHAR(60);
ALTER TABLE ai_generation_logs ADD COLUMN IF NOT EXISTS external_ref  VARCHAR(200);
ALTER TABLE ai_generation_logs ADD COLUMN IF NOT EXISTS model_id      UUID REFERENCES ai_models(id) ON DELETE SET NULL;
ALTER TABLE ai_generation_logs ADD COLUMN IF NOT EXISTS status        VARCHAR(20) NOT NULL DEFAULT 'success';
ALTER TABLE ai_generation_logs ADD COLUMN IF NOT EXISTS prompt_source VARCHAR(20);
ALTER TABLE ai_generation_logs ADD COLUMN IF NOT EXISTS input_tokens  INT;
ALTER TABLE ai_generation_logs ADD COLUMN IF NOT EXISTS output_tokens INT;
ALTER TABLE ai_generation_logs ADD COLUMN IF NOT EXISTS cost_usd      NUMERIC(12,6);
ALTER TABLE ai_generation_logs ADD COLUMN IF NOT EXISTS latency_ms    INT;
ALTER TABLE ai_generation_logs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE ai_generation_logs ADD COLUMN IF NOT EXISTS completed_at  TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_generation_logs_status_check') THEN
    ALTER TABLE ai_generation_logs ADD CONSTRAINT ai_generation_logs_status_check
      CHECK (status IN ('running', 'success', 'failed', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_generation_logs_prompt_source_check') THEN
    -- managed: the published text; edited: a designer changed it for this job;
    -- built_in: the app ran its own fallback text because Decoinks was unreachable.
    ALTER TABLE ai_generation_logs ADD CONSTRAINT ai_generation_logs_prompt_source_check
      CHECK (prompt_source IS NULL OR prompt_source IN ('managed', 'edited', 'built_in'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_ai_generation_logs_source ON ai_generation_logs (source_app, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_generation_logs_version ON ai_generation_logs (prompt_version_id);
CREATE INDEX IF NOT EXISTS idx_ai_generation_logs_model ON ai_generation_logs (model_id);
-- A retried log of the same run updates its row instead of adding a second one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_generation_logs_external
  ON ai_generation_logs (source_app, external_ref, prompt_key)
  WHERE external_ref IS NOT NULL;

-- ── Files a run produced ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prompt_output_files (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  test_run_id       UUID REFERENCES prompt_test_runs(id) ON DELETE CASCADE,
  generation_log_id UUID REFERENCES ai_generation_logs(id) ON DELETE CASCADE,
  file_name         VARCHAR(255),
  file_url          TEXT,
  storage_key       TEXT,
  mime_type         VARCHAR(120),
  size_bytes        BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prompt_output_files_run ON prompt_output_files (test_run_id);
CREATE INDEX IF NOT EXISTS idx_prompt_output_files_log ON prompt_output_files (generation_log_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_output_files_parent_check') THEN
    ALTER TABLE prompt_output_files ADD CONSTRAINT prompt_output_files_parent_check
      CHECK ((test_run_id IS NOT NULL) <> (generation_log_id IS NOT NULL));
  END IF;
END $$;
