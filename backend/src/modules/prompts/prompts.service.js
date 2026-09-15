const crypto = require('crypto')
const { query, getClient } = require('../../config/db')

/**
 * Prompt Management — the AI configuration, and the service apps run it from.
 *
 * One rule shapes everything here: a VERSION is the whole recipe. Instructions,
 * variables and model settings are published together and frozen together, so
 * the question "what produced this artwork?" always has one answer.
 *
 * Draft and Testing are the editable states. Production is read-only, and
 * archived versions are kept for ever, because a generation from months ago
 * still points at the version that made it.
 *
 * Variables are defined once in a library and linked to each version. At
 * publish the link takes a frozen copy of its library row, so a later edit to
 * the library cannot change what a published version meant.
 */

const EDITABLE = ['draft', 'testing']
const editable = (status) => EDITABLE.includes(status)
const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode })
const EDITABLE_SQL = `('draft','testing')`

const VERSION_SELECT = `
  SELECT v.*, u.name AS created_by_name, pb.name AS published_by_name,
         (SELECT COUNT(*)::INT FROM prompt_version_variables pvv WHERE pvv.prompt_version_id = v.id) AS variable_count,
         m.provider, m.model_name, m.temperature, m.max_tokens, m.settings AS model_settings,
         m.model_id, am.model_key, am.display_name AS model_display_name
    FROM prompt_versions v
    LEFT JOIN users u  ON u.id  = v.created_by
    LEFT JOIN users pb ON pb.id = v.published_by
    LEFT JOIN prompt_model_settings m ON m.prompt_version_id = v.id
    LEFT JOIN ai_models am ON am.id = m.model_id`

// A version's variables in the shape the screen and the runtime both read.
// Precedence for the default: this prompt's override, the frozen copy, the library.
const VARIABLE_SELECT = `
  SELECT pvv.id, pvv.prompt_version_id, pvv.variable_id,
         l.variable_key AS variable_name, l.name AS variable_label,
         COALESCE(pvv.snapshot->>'type', l.type) AS type,
         pvv.required,
         COALESCE(pvv.default_value, pvv.snapshot->>'default_value', l.default_value) AS default_value,
         pvv.source,
         COALESCE(pvv.description, pvv.snapshot->>'description', l.description) AS description,
         COALESCE(pvv.snapshot->'validation_rules', l.validation_rules) AS validation_rules,
         pvv.display_order AS sort_order,
         (pvv.snapshot IS NOT NULL) AS frozen,
         pvv.created_at, pvv.updated_at
    FROM prompt_version_variables pvv
    JOIN prompt_variables_library l ON l.id = pvv.variable_id`

async function history(run, versionId, from, to, actorId, note) {
  await run(
    `INSERT INTO prompt_version_history (prompt_version_id, from_status, to_status, changed_by, note)
     VALUES ($1,$2,$3,$4,$5)`, [versionId, from || null, to, actorId || null, note || null])
}

/** The model row for a provider + model name, registered on first use. */
async function ensureModel(run, provider, modelName) {
  const p = String(provider ?? '').trim()
  const m = String(modelName ?? '').trim()
  if (!p || !m) return null
  const key = p.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'provider'
  const { rows: pr } = await run(
    `INSERT INTO ai_providers (provider_key, name) VALUES ($1, $2)
     ON CONFLICT (provider_key) DO UPDATE SET provider_key = EXCLUDED.provider_key
     RETURNING id`, [key, p])
  const { rows: mr } = await run(
    `INSERT INTO ai_models (provider_id, model_key, display_name) VALUES ($1, $2, $2)
     ON CONFLICT (provider_id, model_key) DO UPDATE SET model_key = EXCLUDED.model_key
     RETURNING id`, [pr[0].id, m])
  return mr[0].id
}

async function listPrompts({ search = '', module_id = '', status = '', sort = 'name' } = {}) {
  const where = ['p.deleted_at IS NULL']
  const params = []
  if (search) {
    params.push(`%${search}%`)
    where.push(`(p.name ILIKE $${params.length} OR p.prompt_key ILIKE $${params.length})`)
  }
  if (module_id) { params.push(module_id); where.push(`p.module_id = $${params.length}`) }
  if (status && status !== 'All') { params.push(status); where.push(`p.status = $${params.length}`) }

  const order = sort === 'recent' ? 'p.updated_at DESC' : 'p.name ASC'
  const { rows } = await query(
    `SELECT p.*, m.name AS module_name, m.key AS module_key,
            prod.version_number AS production_version,
            draft.version_number AS draft_version,
            runs.run_count, runs.last_run_at
       FROM prompts p
       LEFT JOIN prompt_modules m ON m.id = p.module_id
       LEFT JOIN prompt_versions prod ON prod.id = p.production_version_id
       LEFT JOIN LATERAL (
         SELECT version_number FROM prompt_versions
          WHERE prompt_id = p.id AND status IN ${EDITABLE_SQL}
          ORDER BY created_at DESC LIMIT 1
       ) draft ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::INT AS run_count, MAX(created_at) AS last_run_at
           FROM ai_generation_logs g WHERE g.prompt_id = p.id
       ) runs ON TRUE
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}`, params)
  return rows
}

async function getPrompt(id) {
  const { rows } = await query(
    `SELECT p.*, m.name AS module_name, m.key AS module_key,
            prod.version_number AS production_version, prod.id AS production_version_id,
            draft.version_number AS draft_version, draft.id AS draft_version_id
       FROM prompts p
       LEFT JOIN prompt_modules m ON m.id = p.module_id
       LEFT JOIN prompt_versions prod ON prod.id = p.production_version_id
       LEFT JOIN LATERAL (
         SELECT id, version_number FROM prompt_versions
          WHERE prompt_id = p.id AND status IN ${EDITABLE_SQL}
          ORDER BY created_at DESC LIMIT 1
       ) draft ON TRUE
      WHERE p.id = $1 AND p.deleted_at IS NULL`, [id])
  if (!rows[0]) throw fail('Prompt not found', 404)
  const versions = (await query(
    `${VERSION_SELECT} WHERE v.prompt_id = $1 ORDER BY v.version_seq DESC, v.created_at DESC`, [id])).rows
  return { ...rows[0], versions }
}

// AIS.<module>.<name> — "Artwork Reconstruction" in Recreation is
// AIS.RECREATION.ARTWORK_RECONSTRUCTION. The screen shows the same thing as a
// preview; this is the one that counts, because only it can see which keys
// are taken.
const keyPart = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
function promptKeyFor(moduleKey, name) {
  return `AIS.${keyPart(moduleKey)}.${keyPart(name)}`.slice(0, 112)
}

async function freeKey(client, base) {
  const { rows } = await client.query(
    `SELECT prompt_key FROM prompts WHERE prompt_key = $1 OR prompt_key LIKE $1 || '\\_%'`, [base])
  const taken = new Set(rows.map(r => r.prompt_key))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`
}

/** A new capability. Improving an existing one is a version, not a prompt. */
async function createPrompt({ name, prompt_key, module_id, description, used_in, created_by }) {
  if (!name || (!prompt_key && !module_id)) {
    throw fail('A prompt needs a name and a module', 422)
  }
  const client = await getClient()
  try {
    await client.query('BEGIN')
    // The key is made from the module it is created in, not typed: the admin
    // names the prompt and picks where it lives, and the key follows.
    if (!prompt_key) {
      const { rows: m } = await client.query(`SELECT key FROM prompt_modules WHERE id = $1`, [module_id])
      if (!m[0]) throw fail('That module does not exist', 422)
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['prompt-key'])
      prompt_key = await freeKey(client, promptKeyFor(m[0].key, name))
    }
    const { rows } = await client.query(
      `INSERT INTO prompts (name, prompt_key, module_id, description, used_in, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, String(prompt_key).toUpperCase(), module_id || null, description || null,
       used_in || null, created_by || null])
    const prompt = rows[0]
    // A prompt with no version cannot be edited or published, so it is born
    // with an empty draft rather than in a state the screen cannot represent.
    const { rows: v } = await client.query(
      `INSERT INTO prompt_versions (prompt_id, version_number, version_seq, status, change_summary, created_by)
       VALUES ($1, '1', 1, 'draft', 'Initial version', $2) RETURNING id`,
      [prompt.id, created_by || null])
    await client.query(
      `INSERT INTO prompt_model_settings (prompt_version_id, model_id)
       VALUES ($1, (SELECT m.id FROM ai_models m JOIN ai_providers p ON p.id = m.provider_id
                     WHERE p.provider_key = 'openai' AND m.model_key = 'GPT-5.5' LIMIT 1))`, [v[0].id])
    await history(client.query.bind(client), v[0].id, null, 'draft', created_by, 'Prompt created')
    await client.query('COMMIT')
    return prompt
  } catch (e) {
    await client.query('ROLLBACK')
    if (e.code === '23505') throw fail(`${prompt_key} already exists`, 409)
    throw e
  } finally { client.release() }
}

async function updatePrompt(id, fields) {
  const allowed = ['name', 'module_id', 'description', 'used_in', 'status']
  const sets = []; const params = []
  for (const key of allowed) {
    if (fields[key] !== undefined) { params.push(fields[key]); sets.push(`${key} = $${params.length}`) }
  }
  if (!sets.length) throw fail('No fields to update', 400)
  params.push(id)
  const { rows } = await query(
    `UPDATE prompts SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`, params)
  if (!rows[0]) throw fail('Prompt not found', 404)
  return rows[0]
}

async function getVersion(id) {
  const { rows } = await query(`${VERSION_SELECT} WHERE v.id = $1`, [id])
  if (!rows[0]) throw fail('Version not found', 404)
  const variables = await listVariables(id)
  const changes = (await query(
    `SELECT h.from_status, h.to_status, h.note, h.changed_at, u.name AS changed_by_name
       FROM prompt_version_history h LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.prompt_version_id = $1 ORDER BY h.changed_at`, [id])).rows
  return { ...rows[0], variables, history: changes }
}

/**
 * A new draft, cloned from whichever version it is based on — production by
 * default. Cloning carries the variables and the model across, because a
 * version that starts empty is not a starting point, it is a blank page.
 */
async function createVersion(promptId, { from_version_id, change_summary, created_by } = {}) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT id FROM prompts WHERE id = $1 FOR UPDATE`, [promptId])
    const { rows: open } = await client.query(
      `SELECT version_number, status FROM prompt_versions
        WHERE prompt_id = $1 AND status IN ${EDITABLE_SQL} LIMIT 1`, [promptId])
    if (open[0]) {
      throw fail(`Version ${open[0].version_number} is still ${open[0].status}. Publish or delete it first.`, 409)
    }

    const { rows: base } = await client.query(
      `SELECT v.* FROM prompt_versions v
        WHERE v.prompt_id = $1 AND ($2::uuid IS NULL OR v.id = $2)
        ORDER BY (v.status = 'production') DESC, v.version_seq DESC LIMIT 1`,
      [promptId, from_version_id || null])

    const { rows: next } = await client.query(
      `SELECT COALESCE(MAX(version_seq), 0) + 1 AS seq FROM prompt_versions WHERE prompt_id = $1`, [promptId])
    const seq = next[0].seq

    const { rows: made } = await client.query(
      `INSERT INTO prompt_versions
         (prompt_id, version_number, version_seq, status, system_instruction, task_instruction,
          dynamic_context, restrictions, change_summary, created_by)
       VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9) RETURNING *`,
      [promptId, String(seq), seq, base[0]?.system_instruction ?? null,
       base[0]?.task_instruction ?? null, base[0]?.dynamic_context ?? null,
       base[0]?.restrictions ?? null, change_summary || null, created_by || null])
    const draft = made[0]

    if (base[0]) {
      // The links, not the frozen copies: a new draft follows the library again
      // until it too is published.
      await client.query(
        `INSERT INTO prompt_version_variables
           (prompt_version_id, variable_id, required, default_value, source, display_order, description, created_by)
         SELECT $1, variable_id, required, default_value, source, display_order, description, $3
           FROM prompt_version_variables WHERE prompt_version_id = $2`, [draft.id, base[0].id, created_by || null])
      await client.query(
        `INSERT INTO prompt_model_settings
           (prompt_version_id, provider, model_name, temperature, max_tokens, settings, model_id)
         SELECT $1, provider, model_name, temperature, max_tokens, settings, model_id
           FROM prompt_model_settings WHERE prompt_version_id = $2`, [draft.id, base[0].id])
    }
    // A version with no model settings cannot run, cloned from something or not.
    await client.query(
      `INSERT INTO prompt_model_settings (prompt_version_id) VALUES ($1)
       ON CONFLICT (prompt_version_id) DO NOTHING`, [draft.id])
    await history(client.query.bind(client), draft.id, null, 'draft', created_by,
      base[0] ? `Created from version ${base[0].version_number}` : 'Created')

    await client.query('COMMIT')
    return draft
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

/** Only a draft or a version under test may be written to. */
async function assertEditable(client, versionId) {
  const { rows } = await client.query(
    `SELECT id, status, version_number FROM prompt_versions WHERE id = $1`, [versionId])
  if (!rows[0]) throw fail('Version not found', 404)
  if (!editable(rows[0].status)) {
    throw fail(`Version ${rows[0].version_number} is ${rows[0].status} and cannot be edited. Create a new version.`, 409)
  }
  return rows[0]
}

async function updateVersion(id, fields) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    await assertEditable(client, id)
    const allowed = ['system_instruction', 'task_instruction', 'dynamic_context',
                     'restrictions', 'change_summary', 'notes']
    const sets = []; const params = []
    for (const key of allowed) {
      if (fields[key] !== undefined) { params.push(fields[key]); sets.push(`${key} = $${params.length}`) }
    }
    if (sets.length) {
      params.push(id)
      await client.query(
        `UPDATE prompt_versions SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${params.length}`, params)
    }

    // Model settings travel with the version, so they are saved with it.
    const m = fields.model
    if (m && typeof m === 'object') {
      const { rows: cur } = await client.query(
        `SELECT provider, model_name FROM prompt_model_settings WHERE prompt_version_id = $1`, [id])
      const provider = m.provider ?? cur[0]?.provider ?? 'OpenAI'
      const modelName = m.model_name ?? cur[0]?.model_name ?? 'GPT-5.5'
      const modelId = await ensureModel(client.query.bind(client), provider, modelName)
      await client.query(
        `INSERT INTO prompt_model_settings
           (prompt_version_id, provider, model_name, temperature, max_tokens, settings, model_id)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6,'{}'::jsonb), $7)
         ON CONFLICT (prompt_version_id) DO UPDATE
            SET provider = EXCLUDED.provider, model_name = EXCLUDED.model_name,
                temperature = EXCLUDED.temperature, max_tokens = EXCLUDED.max_tokens,
                settings = EXCLUDED.settings, model_id = EXCLUDED.model_id, updated_at = NOW()`,
        [id, provider, modelName, m.temperature ?? null, m.max_tokens ?? null,
         m.settings ? JSON.stringify(m.settings) : null, modelId])
    }
    await client.query('COMMIT')
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  return getVersion(id)
}

/** Draft ⇄ Testing. Production is reached only by publishing. */
async function setVersionStatus(id, status, actorId, note) {
  if (!editable(status)) throw fail('A version can be moved only between draft and testing here. Publish to make it live.', 422)
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const cur = await assertEditable(client, id)
    if (cur.status !== status) {
      await client.query(`UPDATE prompt_versions SET status = $2, updated_at = NOW() WHERE id = $1`, [id, status])
      await history(client.query.bind(client), id, cur.status, status, actorId, note)
    }
    await client.query('COMMIT')
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  return getVersion(id)
}

/**
 * The version becomes live. The version that was live is archived rather than
 * removed — rollback needs it, and so does every generation that named it.
 * Publishing freezes the variables it links, and records who did it.
 */
async function publishVersion(id, actorId) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(`SELECT * FROM prompt_versions WHERE id = $1`, [id])
    const version = rows[0]
    if (!version) throw fail('Version not found', 404)
    // One publish at a time per prompt.
    await client.query(`SELECT id FROM prompts WHERE id = $1 FOR UPDATE`, [version.prompt_id])
    if (version.status === 'production') throw fail('This version is already live', 409)
    const text = [version.system_instruction, version.task_instruction, version.dynamic_context, version.restrictions]
      .map(s => String(s ?? '').trim()).join('')
    // An app reading this prompt would receive nothing, so an empty version never goes live.
    if (!text) throw fail(`Version ${version.version_number} has no instructions yet. Write them before publishing.`, 422)

    const run = client.query.bind(client)
    const { rows: live } = await client.query(
      `UPDATE prompt_versions SET status = 'archived', updated_at = NOW()
        WHERE prompt_id = $1 AND status = 'production' RETURNING id`, [version.prompt_id])
    for (const l of live) await history(run, l.id, 'production', 'archived', actorId, `Replaced by version ${version.version_number}`)

    await client.query(
      `UPDATE prompt_version_variables pvv
          SET snapshot = jsonb_build_object(
                'variable_key', l.variable_key, 'name', l.name, 'type', l.type,
                'default_value', l.default_value, 'description', l.description,
                'validation_rules', l.validation_rules),
              updated_at = NOW()
         FROM prompt_variables_library l
        WHERE l.id = pvv.variable_id AND pvv.prompt_version_id = $1 AND pvv.snapshot IS NULL`, [id])

    await client.query(
      `UPDATE prompt_versions
          SET status = 'production', published_at = COALESCE(published_at, NOW()),
              published_by = COALESCE(published_by, $2), updated_at = NOW()
        WHERE id = $1`, [id, actorId || null])
    await history(run, id, version.status, 'production', actorId,
      version.status === 'archived' ? 'Rolled back to this version' : 'Published')
    await client.query(
      `UPDATE prompts SET production_version_id = $2, updated_at = NOW() WHERE id = $1`,
      [version.prompt_id, id])
    await client.query('COMMIT')
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  return getVersion(id)
}

/** An older version becomes live again. Nothing is destroyed. */
async function rollbackVersion(id, actorId) {
  return publishVersion(id, actorId)
}

/** Only an unpublished version may be deleted; anything published is a record. */
async function deleteVersion(id) {
  const { rows } = await query(
    `SELECT status, version_number, published_at FROM prompt_versions WHERE id = $1`, [id])
  if (!rows[0]) throw fail('Version not found', 404)
  if (!editable(rows[0].status) || rows[0].published_at) {
    throw fail(`Version ${rows[0].version_number} has been published and is part of the record. Only an unpublished version can be deleted.`, 409)
  }
  await query(`DELETE FROM prompt_versions WHERE id = $1`, [id])
  return { id }
}

// ── Variables (library + per-version link) ──────────────────────────────────

async function listVariables(versionId) {
  const { rows } = await query(
    `${VARIABLE_SELECT} WHERE pvv.prompt_version_id = $1 ORDER BY pvv.display_order, pvv.created_at`, [versionId])
  return rows
}

async function getVariableLink(run, id) {
  const { rows } = await run(`${VARIABLE_SELECT} WHERE pvv.id = $1`, [id])
  return rows[0] || null
}

async function listLibrary() {
  const { rows } = await query(
    `SELECT l.*, (SELECT COUNT(*)::INT FROM prompt_version_variables pvv WHERE pvv.variable_id = l.id) AS used_by_versions
       FROM prompt_variables_library l WHERE l.deleted_at IS NULL ORDER BY l.variable_key`)
  return rows
}

/**
 * The library row for a key. A new key creates it with this definition; an
 * existing key is reused, and only a type or rules the caller states change it.
 */
async function upsertLibrary(run, data, actorId) {
  const { rows } = await run(
    `INSERT INTO prompt_variables_library (variable_key, name, type, description, default_value, validation_rules, created_by)
     VALUES ($1, $1, COALESCE($2,'Text'), $3, $4, COALESCE($5,'{}'::jsonb), $6)
     ON CONFLICT (variable_key) DO UPDATE
        SET type = COALESCE($2, prompt_variables_library.type),
            validation_rules = COALESCE($5, prompt_variables_library.validation_rules),
            deleted_at = NULL,
            updated_at = CASE WHEN $2 IS NULL AND $5 IS NULL THEN prompt_variables_library.updated_at ELSE NOW() END
     RETURNING id, (xmax = 0) AS inserted`,
    [data.variable_name, data.type ?? null, data.description ?? null, data.default_value ?? null,
     data.validation_rules ? JSON.stringify(data.validation_rules) : null, actorId || null])
  return rows[0]
}

async function createVariable(versionId, data, actorId) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    await assertEditable(client, versionId)
    const run = client.query.bind(client)
    const lib = await upsertLibrary(run, data, actorId)
    const { rows } = await client.query(
      `INSERT INTO prompt_version_variables
         (prompt_version_id, variable_id, required, default_value, source, description, display_order, created_by)
       VALUES ($1,$2,COALESCE($3,FALSE),$4,COALESCE($5,'Job / CRM'),$6,
               COALESCE((SELECT MAX(display_order)+1 FROM prompt_version_variables WHERE prompt_version_id = $1), 0), $7)
       RETURNING id`,
      // A brand-new library row already holds this default; an existing one keeps
      // its own, and this prompt's value becomes an override.
      [versionId, lib.id, data.required ?? null, lib.inserted ? null : (data.default_value ?? null),
       data.source ?? null, lib.inserted ? null : (data.description ?? null), actorId || null])
    const row = await getVariableLink(run, rows[0].id)
    await client.query('COMMIT')
    return row
  } catch (e) {
    await client.query('ROLLBACK')
    if (e.code === '23505') throw fail(`${data.variable_name} is already defined on this version`, 409)
    throw e
  } finally { client.release() }
}

async function updateVariable(id, data, actorId) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const run = client.query.bind(client)
    const { rows: owner } = await client.query(
      `SELECT pvv.prompt_version_id, pvv.variable_id FROM prompt_version_variables pvv WHERE pvv.id = $1`, [id])
    if (!owner[0]) throw fail('Variable not found', 404)
    await assertEditable(client, owner[0].prompt_version_id)

    let variableId = owner[0].variable_id
    if (data.variable_name !== undefined) {
      variableId = (await upsertLibrary(run, { variable_name: data.variable_name }, actorId)).id
    }
    // Type and rules are the variable's definition, shared by every prompt that
    // links it; published versions keep their frozen copy.
    if (data.type !== undefined || data.validation_rules !== undefined) {
      await client.query(
        `UPDATE prompt_variables_library
            SET type = COALESCE($2, type), validation_rules = COALESCE($3, validation_rules), updated_at = NOW()
          WHERE id = $1`,
        [variableId, data.type ?? null, data.validation_rules ? JSON.stringify(data.validation_rules) : null])
    }
    const link = { required: data.required, default_value: data.default_value, source: data.source,
                   description: data.description, display_order: data.sort_order }
    const sets = ['variable_id = $2']; const params = [id, variableId]
    for (const [key, value] of Object.entries(link)) {
      if (value === undefined) continue
      params.push(value); sets.push(`${key} = $${params.length}`)
    }
    await client.query(
      `UPDATE prompt_version_variables SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, params)
    const row = await getVariableLink(run, id)
    await client.query('COMMIT')
    return row
  } catch (e) {
    await client.query('ROLLBACK')
    if (e.code === '23505') throw fail(`${data.variable_name} is already defined on this version`, 409)
    throw e
  } finally { client.release() }
}

async function deleteVariable(id) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: owner } = await client.query(
      `SELECT prompt_version_id FROM prompt_version_variables WHERE id = $1`, [id])
    if (!owner[0]) throw fail('Variable not found', 404)
    await assertEditable(client, owner[0].prompt_version_id)
    await client.query(`DELETE FROM prompt_version_variables WHERE id = $1`, [id])
    await client.query('COMMIT')
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  return { id }
}

// ── Composing, resolving and testing ─────────────────────────────────────────

const SECTIONS = [
  ['system_instruction', 'SYSTEM INSTRUCTIONS'],
  ['task_instruction', 'TASK INSTRUCTIONS'],
  ['dynamic_context', 'CONTEXT'],
  ['restrictions', 'RESTRICTIONS'],
]

/**
 * The instruction text a model receives. One filled section is sent exactly as
 * written — an app that imported a single prompt must get that prompt back,
 * byte for byte. Several sections are labelled so the model can tell them apart.
 */
function composeText(version, fill = s => String(s ?? '')) {
  const filled = SECTIONS.filter(([k]) => String(version[k] ?? '').trim() !== '')
  if (filled.length === 1) return fill(version[filled[0][0]])
  return filled.map(([k, label]) => `${label}\n${fill(version[k])}`).join('\n\n')
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

/**
 * The text the model will actually receive, with every {{variable}} filled in.
 *
 * A missing value is left as its own placeholder rather than blanked, because
 * an admin reading the preview needs to see which one did not arrive — a silent
 * gap looks like a badly written prompt when the real fault is upstream.
 */
function resolvePrompt(version, values = {}) {
  const supplied = { ...values }
  for (const v of version.variables ?? []) {
    if (supplied[v.variable_name] === undefined || supplied[v.variable_name] === '') {
      if (v.default_value != null && v.default_value !== '') supplied[v.variable_name] = v.default_value
    }
  }
  const fill = text => String(text ?? '').replace(PLACEHOLDER,
    (whole, name) => (supplied[name] !== undefined && supplied[name] !== '' ? String(supplied[name]) : whole))

  const missing = (version.variables ?? [])
    .filter(v => v.required && (supplied[v.variable_name] === undefined || supplied[v.variable_name] === ''))
    .map(v => v.variable_name)

  return { resolved_prompt: composeText(version, fill), values: supplied, missing_required: missing }
}

async function previewVersion(id, values) {
  return resolvePrompt(await getVersion(id), values)
}

/**
 * Runs the version against test values and keeps the result as
 * test → input → run.
 *
 * No model is called from here — the studio's model runs inside the apps that
 * use these prompts (Artwork Automation drives ChatGPT in a designer's browser)
 * — so the run is recorded as "resolved": the exact text that would be sent,
 * with the settings it would run on.
 */
async function testVersion(id, { values = {}, tested_by, test_name } = {}) {
  const version = await getVersion(id)
  const resolved = resolvePrompt(version, values)
  const ok = resolved.missing_required.length === 0
  const output = ok
    ? { status: 'resolved',
        note: 'Prompt resolved. No model call was made here — the apps that use this prompt run the model.',
        model: { provider: version.provider, model: version.model_key || version.model_name,
                 temperature: version.temperature, max_tokens: version.max_tokens } }
    : { status: 'incomplete', note: `Missing required values: ${resolved.missing_required.join(', ')}` }

  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO prompt_tests (prompt_version_id, test_name, input_data, output_data, resolved_prompt, status, tested_by)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7) RETURNING *`,
      [id, test_name || 'Preview test', JSON.stringify(values), JSON.stringify(output), resolved.resolved_prompt,
       ok ? 'ok' : 'failed', tested_by || null])
    const test = rows[0]
    const { rows: input } = await client.query(
      `INSERT INTO prompt_test_inputs (test_id, input_data, input_type, created_by)
       VALUES ($1, $2::jsonb, 'json', $3) RETURNING id`, [test.id, JSON.stringify(values), tested_by || null])
    const { rows: setting } = await client.query(
      `SELECT id FROM prompt_model_settings WHERE prompt_version_id = $1`, [id])
    const { rows: runRow } = await client.query(
      `INSERT INTO prompt_test_runs
         (input_id, prompt_version_id, prompt_model_setting_id, model_id, settings_snapshot, resolved_prompt,
          status, started_at, completed_at, error_message, output_data, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,NOW(),NOW(),$8,$9::jsonb,$10) RETURNING id`,
      [input[0].id, id, setting[0]?.id ?? null, version.model_id ?? null,
       JSON.stringify({ provider: version.provider, model_name: version.model_name, model_key: version.model_key,
                        temperature: version.temperature, max_tokens: version.max_tokens,
                        settings: version.model_settings ?? {} }),
       resolved.resolved_prompt, ok ? 'resolved' : 'failed', ok ? null : output.note,
       JSON.stringify(output), tested_by || null])
    await client.query('COMMIT')
    return { ...test, run_id: runRow[0].id, ...resolved }
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

async function listTests(versionId, limit = 20) {
  const { rows } = await query(
    `SELECT t.*, u.name AS tested_by_name FROM prompt_tests t
       LEFT JOIN users u ON u.id = t.tested_by
      WHERE t.prompt_version_id = $1 ORDER BY t.created_at DESC LIMIT $2`, [versionId, limit])
  return rows
}

async function listModules() {
  const { rows } = await query(`SELECT * FROM prompt_modules ORDER BY name`)
  return rows
}

async function createModule({ name, key, description, created_by }) {
  const { rows } = await query(
    `INSERT INTO prompt_modules (name, key, description, created_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
     RETURNING *`, [name, String(key).toUpperCase(), description || null, created_by || null])
  return rows[0]
}

async function listModels() {
  const { rows } = await query(
    `SELECT m.id, m.model_key, m.display_name, m.status, m.supports_image_input, m.supports_image_output,
            m.supports_json_mode, m.context_window, m.max_output_tokens, m.input_price_per_1k, m.output_price_per_1k,
            p.id AS provider_id, p.provider_key, p.name AS provider_name, p.status AS provider_status
       FROM ai_models m JOIN ai_providers p ON p.id = m.provider_id
      ORDER BY p.name, m.display_name`)
  return rows
}

async function listGenerations(promptId, limit = 50) {
  const { rows } = await query(
    `SELECT g.id, g.prompt_key, g.source_app, g.external_ref, g.status, g.prompt_source,
            g.model_used, g.input_tokens, g.output_tokens, g.cost_usd, g.latency_ms, g.error_message,
            g.input_variables, g.output_reference, g.created_at, g.completed_at,
            v.version_number, v.version_seq,
            (SELECT COALESCE(json_agg(json_build_object('file_name', f.file_name, 'file_url', f.file_url)), '[]'::json)
               FROM prompt_output_files f WHERE f.generation_log_id = g.id) AS files
       FROM ai_generation_logs g
       LEFT JOIN prompt_versions v ON v.id = g.prompt_version_id
      WHERE g.prompt_id = $1
      ORDER BY g.created_at DESC LIMIT $2`, [promptId, Math.min(Number(limit) || 50, 200)])
  return rows
}

// ── Runtime: what consuming apps call (service-authenticated) ────────────────

/**
 * The live version of each requested prompt, ready to run: the composed text
 * (placeholders still in it), the variables it expects, and the model settings.
 * Only Active prompts with a production version are served — a draft never
 * reaches an app.
 */
async function productionPrompts({ keys = [], module = '' } = {}) {
  const wanted = [...new Set(keys.map(k => String(k).trim().toUpperCase()).filter(Boolean))]
  const params = []
  const where = [`p.deleted_at IS NULL`, `p.status = 'Active'`, `v.status = 'production'`]
  if (wanted.length) { params.push(wanted); where.push(`p.prompt_key = ANY($${params.length})`) }
  if (module) { params.push(String(module).toUpperCase()); where.push(`m.key = $${params.length}`) }

  const { rows } = await query(
    `SELECT p.id AS prompt_id, p.prompt_key, p.name, m.key AS module_key,
            v.id AS version_id, v.version_seq, v.version_number, v.published_at,
            v.system_instruction, v.task_instruction, v.dynamic_context, v.restrictions,
            ms.provider, ms.model_name, ms.temperature, ms.max_tokens, ms.settings,
            am.model_key, am.display_name AS model_display_name
       FROM prompts p
       JOIN prompt_versions v ON v.id = p.production_version_id
       LEFT JOIN prompt_modules m ON m.id = p.module_id
       LEFT JOIN prompt_model_settings ms ON ms.prompt_version_id = v.id
       LEFT JOIN ai_models am ON am.id = ms.model_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.prompt_key`, params)

  const versionIds = rows.map(r => r.version_id)
  const { rows: vars } = versionIds.length
    ? await query(`${VARIABLE_SELECT} WHERE pvv.prompt_version_id = ANY($1) ORDER BY pvv.display_order`, [versionIds])
    : { rows: [] }

  const prompts = rows.map(r => {
    const text = composeText(r)
    return {
      prompt_key: r.prompt_key,
      name: r.name,
      module: r.module_key,
      version: { id: r.version_id, number: r.version_seq, label: r.version_number, published_at: r.published_at },
      text,
      placeholders: [...new Set([...text.matchAll(PLACEHOLDER)].map(x => x[1]))],
      variables: vars.filter(v => v.prompt_version_id === r.version_id).map(v => ({
        key: v.variable_name, type: v.type, required: v.required, default_value: v.default_value,
        source: v.source, description: v.description, validation_rules: v.validation_rules,
      })),
      model: {
        provider: r.provider, model_key: r.model_key || r.model_name, display_name: r.model_display_name || r.model_name,
        temperature: r.temperature == null ? null : Number(r.temperature), max_tokens: r.max_tokens, settings: r.settings ?? {},
      },
    }
  })
  const served = new Set(prompts.map(p => p.prompt_key))
  const revision = crypto.createHash('sha1')
    .update(prompts.map(p => `${p.prompt_key}:${p.version.id}`).join('|')).digest('hex').slice(0, 16)
  return { revision, prompts, missing: wanted.filter(k => !served.has(k)) }
}

const RUN_STATUSES = new Set(['running', 'success', 'failed', 'cancelled'])

/**
 * Records live runs reported by an app. Idempotent per (app, external_ref,
 * prompt): a retried report updates the row instead of adding a second one.
 */
async function logGenerations(runs = []) {
  const client = await getClient()
  const ids = []
  try {
    await client.query('BEGIN')
    const run = client.query.bind(client)
    for (const r of runs) {
      const key = String(r.prompt_key || '').trim().toUpperCase()
      const { rows: pr } = await client.query(
        `SELECT id, production_version_id FROM prompts WHERE prompt_key = $1`, [key])
      const promptId = pr[0]?.id ?? null
      let versionId = r.prompt_version_id || null
      if (versionId) {
        const { rows: ok } = await client.query(
          `SELECT 1 FROM prompt_versions WHERE id = $1 AND prompt_id IS NOT DISTINCT FROM $2`, [versionId, promptId])
        if (!ok[0]) versionId = null
      }
      const modelId = await ensureModel(run, r.provider, r.model)
      const status = RUN_STATUSES.has(r.status) ? r.status : 'success'
      const values = [
        promptId, versionId, key, r.source_app, r.external_ref || null,
        JSON.stringify(r.input_variables || {}), r.resolved_prompt ?? null,
        [r.provider, r.model].filter(Boolean).join(' / ') || null,
        JSON.stringify(r.model_parameters || {}), r.output_reference ?? null, modelId, status,
        r.prompt_source ?? null, r.input_tokens ?? null, r.output_tokens ?? null, r.cost_usd ?? null,
        r.latency_ms ?? null, r.error_message ?? null,
        r.completed_at || (status === 'running' ? null : new Date().toISOString()),
      ]
      const { rows } = await client.query(
        `INSERT INTO ai_generation_logs
           (prompt_id, prompt_version_id, prompt_key, source_app, external_ref, input_variables, resolved_prompt,
            model_used, model_parameters, output_reference, model_id, status, prompt_source,
            input_tokens, output_tokens, cost_usd, latency_ms, error_message, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (source_app, external_ref, prompt_key) WHERE external_ref IS NOT NULL
         DO UPDATE SET status = EXCLUDED.status, prompt_version_id = COALESCE(EXCLUDED.prompt_version_id, ai_generation_logs.prompt_version_id),
                       input_variables = EXCLUDED.input_variables, resolved_prompt = EXCLUDED.resolved_prompt,
                       model_used = EXCLUDED.model_used, model_parameters = EXCLUDED.model_parameters,
                       output_reference = EXCLUDED.output_reference, model_id = EXCLUDED.model_id,
                       prompt_source = EXCLUDED.prompt_source, input_tokens = EXCLUDED.input_tokens,
                       output_tokens = EXCLUDED.output_tokens, cost_usd = EXCLUDED.cost_usd,
                       latency_ms = EXCLUDED.latency_ms, error_message = EXCLUDED.error_message,
                       completed_at = EXCLUDED.completed_at
         RETURNING id`, values)
      const logId = rows[0].id
      if (Array.isArray(r.output_files)) {
        await client.query(`DELETE FROM prompt_output_files WHERE generation_log_id = $1`, [logId])
        for (const f of r.output_files) {
          await client.query(
            `INSERT INTO prompt_output_files (generation_log_id, file_name, file_url, mime_type, size_bytes)
             VALUES ($1,$2,$3,$4,$5)`,
            [logId, f.file_name ?? null, f.file_url ?? null, f.mime_type ?? null, f.size_bytes ?? null])
        }
      }
      ids.push({ id: logId, prompt_key: key, prompt_found: Boolean(promptId) })
    }
    await client.query('COMMIT')
    return ids
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

module.exports = {
  listPrompts, getPrompt, createPrompt, updatePrompt,
  createVersion, getVersion, updateVersion, setVersionStatus, publishVersion, rollbackVersion, deleteVersion,
  listVariables, createVariable, updateVariable, deleteVariable, listLibrary,
  previewVersion, testVersion, listTests, resolvePrompt, composeText,
  listModules, createModule, listModels, listGenerations,
  productionPrompts, logGenerations,
}
