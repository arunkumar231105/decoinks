-- Prompt Management: the AI's instructions, kept the way code is kept.
--
-- Until now an AI instruction lived wherever it was written and changed under
-- whoever changed it, with no record of what produced any given result. This
-- gives the studio's prompts the three things any production configuration
-- needs: one place to edit them, a version that can be published or rolled
-- back, and a log tying every generated artwork to the exact configuration that
-- made it.
--
-- The shape follows one rule: a VERSION is the whole recipe. Its instructions,
-- its variables and its model settings are published together and frozen
-- together, so "what generated this?" always has one answer. Variables and
-- model settings therefore hang off prompt_versions, never off prompts.
--
-- Additive: seven new tables, nothing existing is touched.

-- A studio area — Reconstruction, Variations, Mockups.
CREATE TABLE IF NOT EXISTS prompt_modules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(120) NOT NULL,
  key         VARCHAR(80)  NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A prompt family. AIS.RECREATE.GENERATE is one capability, for the life of the
-- studio; improving it makes a version, not another prompt.
CREATE TABLE IF NOT EXISTS prompts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  module_id     UUID REFERENCES prompt_modules(id) ON DELETE SET NULL,
  name          VARCHAR(160) NOT NULL,
  prompt_key    VARCHAR(120) NOT NULL UNIQUE,
  description   TEXT,
  -- Where in the application this prompt actually runs, so an admin can see
  -- what a change will affect before making it.
  used_in       VARCHAR(200),
  status        VARCHAR(20) NOT NULL DEFAULT 'Active'
                CHECK (status IN ('Active', 'Disabled', 'Archived')),
  -- Set when a version is published. Deliberately no FK: the column is filled
  -- by publish(), and a circular constraint between the two tables would make
  -- both harder to write than the rule is worth.
  production_version_id UUID,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_prompts_module ON prompts (module_id);
CREATE INDEX IF NOT EXISTS idx_prompts_status ON prompts (status) WHERE deleted_at IS NULL;

-- One frozen recipe. Draft is editable, Production is live, Archived is history
-- — and history is never deleted, because a generation months old still points
-- at the version that made it.
CREATE TABLE IF NOT EXISTS prompt_versions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prompt_id        UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  version_number   VARCHAR(20) NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'production', 'archived')),
  system_instruction TEXT,
  task_instruction   TEXT,
  dynamic_context    TEXT,
  restrictions       TEXT,
  change_summary   VARCHAR(300),
  notes            TEXT,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at     TIMESTAMPTZ,
  UNIQUE (prompt_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt ON prompt_versions (prompt_id, created_at DESC);
-- One live version per prompt, enforced here rather than trusted to the code
-- that publishes.
CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_one_production
  ON prompt_versions (prompt_id) WHERE status = 'production';

-- What may change from job to job without touching the instructions.
CREATE TABLE IF NOT EXISTS prompt_variables (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prompt_version_id UUID NOT NULL REFERENCES prompt_versions(id) ON DELETE CASCADE,
  variable_name     VARCHAR(80) NOT NULL,
  type              VARCHAR(20) NOT NULL DEFAULT 'Text'
                    CHECK (type IN ('Text','Image','Boolean','Enum','Number','Ratio','Color','Asset','Array')),
  required          BOOLEAN NOT NULL DEFAULT FALSE,
  default_value     TEXT,
  source            VARCHAR(40) NOT NULL DEFAULT 'Job / CRM'
                    CHECK (source IN ('Job / CRM','Uploaded Asset','UI Selection','System','Previous Step','AI Output','Database')),
  description       TEXT,
  validation_rules  JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order        INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A prompt cannot ask for the same variable twice.
  UNIQUE (prompt_version_id, variable_name)
);
CREATE INDEX IF NOT EXISTS idx_prompt_variables_version ON prompt_variables (prompt_version_id, sort_order);

-- Which model runs this version, and how. Part of the version, so publishing
-- freezes the model with the words — otherwise the settings could drift weeks
-- later and nobody would know what produced an output.
CREATE TABLE IF NOT EXISTS prompt_model_settings (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prompt_version_id UUID NOT NULL UNIQUE REFERENCES prompt_versions(id) ON DELETE CASCADE,
  provider          VARCHAR(60)  NOT NULL DEFAULT 'OpenAI',
  model_name        VARCHAR(120) NOT NULL DEFAULT 'GPT-5.5',
  temperature       NUMERIC(4,2),
  max_tokens        INT,
  -- Anything the provider takes that the columns above do not name. Providers
  -- differ, and a column per parameter would be a migration per provider.
  settings          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A draft tried before anyone is asked to live with it.
CREATE TABLE IF NOT EXISTS prompt_tests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prompt_version_id UUID NOT NULL REFERENCES prompt_versions(id) ON DELETE CASCADE,
  input_data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_prompt   TEXT,
  status            VARCHAR(20) NOT NULL DEFAULT 'ok'
                    CHECK (status IN ('ok', 'failed')),
  tested_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prompt_tests_version ON prompt_tests (prompt_version_id, created_at DESC);

-- Every execution, with the exact text that was sent. This is the record that
-- answers "why did this artwork come out this way?" long after the version has
-- been superseded — so it keeps the resolved prompt itself, not a reference to
-- something that may since have changed.
CREATE TABLE IF NOT EXISTS ai_generation_logs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prompt_id         UUID REFERENCES prompts(id) ON DELETE SET NULL,
  prompt_version_id UUID REFERENCES prompt_versions(id) ON DELETE SET NULL,
  job_id            UUID,
  input_variables   JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_prompt   TEXT,
  model_used        VARCHAR(160),
  model_parameters  JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_reference  TEXT,
  operator_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_generation_logs_prompt ON ai_generation_logs (prompt_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_generation_logs_job ON ai_generation_logs (job_id);
