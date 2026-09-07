const { query, getClient } = require('../../config/db')

/**
 * Prompt Management — the studio's AI configuration.
 *
 * One rule shapes everything here: a VERSION is the whole recipe. Instructions,
 * variables and model settings are published together and frozen together, so
 * the question "what produced this artwork?" always has one answer. That is why
 * variables and model settings hang off prompt_versions and never off prompts.
 *
 * Draft is the only editable state. Production is read-only, and archived
 * versions are kept for ever, because a generation from months ago still points
 * at the version that made it.
 */

const EDITABLE = 'draft'

const VERSION_SELECT = `
  SELECT v.*, u.name AS created_by_name,
         (SELECT COUNT(*)::INT FROM prompt_variables pv WHERE pv.prompt_version_id = v.id) AS variable_count,
         m.provider, m.model_name, m.temperature, m.max_tokens, m.settings AS model_settings
    FROM prompt_versions v
    LEFT JOIN users u ON u.id = v.created_by
    LEFT JOIN prompt_model_settings m ON m.prompt_version_id = v.id`

// 2.3.0 -> 2.4.0. The middle number moves because a new version is a change of
// behaviour, not a patch.
function bumpMinor(version) {
  const [major = 1, minor = 0] = String(version || '1.0.0').split('.').map(Number)
  return `${major}.${(Number.isFinite(minor) ? minor : 0) + 1}.0`
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
            draft.version_number AS draft_version
       FROM prompts p
       LEFT JOIN prompt_modules m ON m.id = p.module_id
       LEFT JOIN prompt_versions prod ON prod.id = p.production_version_id
       LEFT JOIN LATERAL (
         SELECT version_number FROM prompt_versions
          WHERE prompt_id = p.id AND status = '${EDITABLE}'
          ORDER BY created_at DESC LIMIT 1
       ) draft ON TRUE
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
          WHERE prompt_id = p.id AND status = '${EDITABLE}'
          ORDER BY created_at DESC LIMIT 1
       ) draft ON TRUE
      WHERE p.id = $1 AND p.deleted_at IS NULL`, [id])
  if (!rows[0]) throw Object.assign(new Error('Prompt not found'), { statusCode: 404 })
  const versions = (await query(
    `${VERSION_SELECT} WHERE v.prompt_id = $1 ORDER BY v.created_at DESC`, [id])).rows
  return { ...rows[0], versions }
}

/** A new capability. Improving an existing one is a version, not a prompt. */
async function createPrompt({ name, prompt_key, module_id, description, used_in, created_by }) {
  if (!name || !prompt_key) {
    throw Object.assign(new Error('A prompt needs a name and a key'), { statusCode: 422 })
  }
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO prompts (name, prompt_key, module_id, description, used_in, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, String(prompt_key).toUpperCase(), module_id || null, description || null,
       used_in || null, created_by || null])
    const prompt = rows[0]
    // A prompt with no version cannot be edited or published, so it is born
    // with an empty draft rather than in a state the screen cannot represent.
    const { rows: v } = await client.query(
      `INSERT INTO prompt_versions (prompt_id, version_number, status, change_summary, created_by)
       VALUES ($1, '1.0.0', '${EDITABLE}', 'Initial version', $2) RETURNING id`,
      [prompt.id, created_by || null])
    await client.query(
      `INSERT INTO prompt_model_settings (prompt_version_id) VALUES ($1)`, [v[0].id])
    await client.query('COMMIT')
    return prompt
  } catch (e) {
    await client.query('ROLLBACK')
    if (e.code === '23505') {
      throw Object.assign(new Error(`${prompt_key} already exists`), { statusCode: 409 })
    }
    throw e
  } finally { client.release() }
}

async function updatePrompt(id, fields) {
  const allowed = ['name', 'module_id', 'description', 'used_in', 'status']
  const sets = []; const params = []
  for (const key of allowed) {
    if (fields[key] !== undefined) { params.push(fields[key]); sets.push(`${key} = $${params.length}`) }
  }
  if (!sets.length) throw Object.assign(new Error('No fields to update'), { statusCode: 400 })
  params.push(id)
  const { rows } = await query(
    `UPDATE prompts SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`, params)
  if (!rows[0]) throw Object.assign(new Error('Prompt not found'), { statusCode: 404 })
  return rows[0]
}

async function getVersion(id) {
  const { rows } = await query(`${VERSION_SELECT} WHERE v.id = $1`, [id])
  if (!rows[0]) throw Object.assign(new Error('Version not found'), { statusCode: 404 })
  const variables = (await query(
    `SELECT * FROM prompt_variables WHERE prompt_version_id = $1 ORDER BY sort_order, created_at`,
    [id])).rows
  return { ...rows[0], variables }
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
    const { rows: open } = await client.query(
      `SELECT version_number FROM prompt_versions
        WHERE prompt_id = $1 AND status = '${EDITABLE}' LIMIT 1`, [promptId])
    if (open[0]) {
      throw Object.assign(
        new Error(`Draft ${open[0].version_number} is already open. Publish or delete it first.`),
        { statusCode: 409 })
    }

    const { rows: base } = await client.query(
      `SELECT v.* FROM prompt_versions v
        WHERE v.prompt_id = $1 AND ($2::uuid IS NULL OR v.id = $2)
        ORDER BY (v.status = 'production') DESC, v.created_at DESC LIMIT 1`,
      [promptId, from_version_id || null])

    const { rows: highest } = await client.query(
      `SELECT version_number FROM prompt_versions WHERE prompt_id = $1
        ORDER BY string_to_array(version_number, '.')::int[] DESC LIMIT 1`, [promptId])

    const { rows: made } = await client.query(
      `INSERT INTO prompt_versions
         (prompt_id, version_number, status, system_instruction, task_instruction,
          dynamic_context, restrictions, change_summary, created_by)
       VALUES ($1,$2,'${EDITABLE}',$3,$4,$5,$6,$7,$8) RETURNING *`,
      [promptId, bumpMinor(highest[0]?.version_number), base[0]?.system_instruction ?? null,
       base[0]?.task_instruction ?? null, base[0]?.dynamic_context ?? null,
       base[0]?.restrictions ?? null, change_summary || null, created_by || null])
    const draft = made[0]

    if (base[0]) {
      await client.query(
        `INSERT INTO prompt_variables
           (prompt_version_id, variable_name, type, required, default_value, source,
            description, validation_rules, sort_order)
         SELECT $1, variable_name, type, required, default_value, source,
                description, validation_rules, sort_order
           FROM prompt_variables WHERE prompt_version_id = $2`, [draft.id, base[0].id])
      await client.query(
        `INSERT INTO prompt_model_settings
           (prompt_version_id, provider, model_name, temperature, max_tokens, settings)
         SELECT $1, provider, model_name, temperature, max_tokens, settings
           FROM prompt_model_settings WHERE prompt_version_id = $2`, [draft.id, base[0].id])
    }
    // A version with no model settings cannot run, cloned from something or not.
    await client.query(
      `INSERT INTO prompt_model_settings (prompt_version_id) VALUES ($1)
       ON CONFLICT (prompt_version_id) DO NOTHING`, [draft.id])

    await client.query('COMMIT')
    return draft
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

/** Only a draft may be written to. Production is the record of what ran. */
async function assertDraft(client, versionId) {
  const { rows } = await client.query(
    `SELECT id, status, version_number FROM prompt_versions WHERE id = $1`, [versionId])
  if (!rows[0]) throw Object.assign(new Error('Version not found'), { statusCode: 404 })
  if (rows[0].status !== EDITABLE) {
    throw Object.assign(
      new Error(`Version ${rows[0].version_number} is ${rows[0].status} and cannot be edited. Create a new version.`),
      { statusCode: 409 })
  }
  return rows[0]
}

async function updateVersion(id, fields) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    await assertDraft(client, id)
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
      await client.query(
        `INSERT INTO prompt_model_settings
           (prompt_version_id, provider, model_name, temperature, max_tokens, settings)
         VALUES ($1, COALESCE($2,'OpenAI'), COALESCE($3,'GPT-5.5'), $4, $5, COALESCE($6,'{}'::jsonb))
         ON CONFLICT (prompt_version_id) DO UPDATE
            SET provider = EXCLUDED.provider, model_name = EXCLUDED.model_name,
                temperature = EXCLUDED.temperature, max_tokens = EXCLUDED.max_tokens,
                settings = EXCLUDED.settings, updated_at = NOW()`,
        [id, m.provider ?? null, m.model_name ?? null,
         m.temperature ?? null, m.max_tokens ?? null,
         m.settings ? JSON.stringify(m.settings) : null])
    }
    await client.query('COMMIT')
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  return getVersion(id)
}

/**
 * The draft becomes live. The version that was live is archived rather than
 * removed — rollback needs it, and so does every generation that named it.
 */
async function publishVersion(id, actorId) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `SELECT * FROM prompt_versions WHERE id = $1`, [id])
    const version = rows[0]
    if (!version) throw Object.assign(new Error('Version not found'), { statusCode: 404 })
    if (version.status === 'production') {
      throw Object.assign(new Error('This version is already live'), { statusCode: 409 })
    }
    await client.query(
      `UPDATE prompt_versions SET status = 'archived', updated_at = NOW()
        WHERE prompt_id = $1 AND status = 'production'`, [version.prompt_id])
    await client.query(
      `UPDATE prompt_versions
          SET status = 'production', published_at = COALESCE(published_at, NOW()), updated_at = NOW()
        WHERE id = $1`, [id])
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

/** Only an unpublished draft may be deleted; anything published is a record. */
async function deleteVersion(id) {
  const { rows } = await query(
    `SELECT status, version_number, published_at FROM prompt_versions WHERE id = $1`, [id])
  if (!rows[0]) throw Object.assign(new Error('Version not found'), { statusCode: 404 })
  if (rows[0].status !== EDITABLE || rows[0].published_at) {
    throw Object.assign(
      new Error(`Version ${rows[0].version_number} has been published and is part of the record. Only a draft can be deleted.`),
      { statusCode: 409 })
  }
  await query(`DELETE FROM prompt_versions WHERE id = $1`, [id])
  return { id }
}

// ── Variables ────────────────────────────────────────────────────────────────

async function listVariables(versionId) {
  const { rows } = await query(
    `SELECT * FROM prompt_variables WHERE prompt_version_id = $1 ORDER BY sort_order, created_at`,
    [versionId])
  return rows
}

async function createVariable(versionId, data) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    await assertDraft(client, versionId)
    const { rows } = await client.query(
      `INSERT INTO prompt_variables
         (prompt_version_id, variable_name, type, required, default_value, source,
          description, validation_rules, sort_order)
       VALUES ($1,$2,COALESCE($3,'Text'),COALESCE($4,FALSE),$5,COALESCE($6,'Job / CRM'),$7,
               COALESCE($8,'{}'::jsonb),
               COALESCE((SELECT MAX(sort_order)+1 FROM prompt_variables WHERE prompt_version_id = $1), 0))
       RETURNING *`,
      [versionId, data.variable_name, data.type ?? null, data.required ?? null,
       data.default_value ?? null, data.source ?? null, data.description ?? null,
       data.validation_rules ? JSON.stringify(data.validation_rules) : null])
    await client.query('COMMIT')
    return rows[0]
  } catch (e) {
    await client.query('ROLLBACK')
    if (e.code === '23505') {
      throw Object.assign(new Error(`${data.variable_name} is already defined on this version`), { statusCode: 409 })
    }
    throw e
  } finally { client.release() }
}

async function updateVariable(id, data) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: owner } = await client.query(
      `SELECT prompt_version_id FROM prompt_variables WHERE id = $1`, [id])
    if (!owner[0]) throw Object.assign(new Error('Variable not found'), { statusCode: 404 })
    await assertDraft(client, owner[0].prompt_version_id)

    const allowed = ['variable_name', 'type', 'required', 'default_value', 'source',
                     'description', 'validation_rules', 'sort_order']
    const sets = []; const params = []
    for (const key of allowed) {
      if (data[key] === undefined) continue
      params.push(key === 'validation_rules' ? JSON.stringify(data[key]) : data[key])
      sets.push(`${key} = $${params.length}${key === 'validation_rules' ? '::jsonb' : ''}`)
    }
    if (!sets.length) throw Object.assign(new Error('No fields to update'), { statusCode: 400 })
    params.push(id)
    const { rows } = await client.query(
      `UPDATE prompt_variables SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING *`, params)
    await client.query('COMMIT')
    return rows[0]
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}

async function deleteVariable(id) {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const { rows: owner } = await client.query(
      `SELECT prompt_version_id FROM prompt_variables WHERE id = $1`, [id])
    if (!owner[0]) throw Object.assign(new Error('Variable not found'), { statusCode: 404 })
    await assertDraft(client, owner[0].prompt_version_id)
    await client.query(`DELETE FROM prompt_variables WHERE id = $1`, [id])
    await client.query('COMMIT')
  } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
  return { id }
}

// ── Resolving and testing ────────────────────────────────────────────────────

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
  const fill = text => String(text ?? '').replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (whole, name) => (supplied[name] !== undefined && supplied[name] !== ''
      ? String(supplied[name]) : whole))

  const missing = (version.variables ?? [])
    .filter(v => v.required && (supplied[v.variable_name] === undefined || supplied[v.variable_name] === ''))
    .map(v => v.variable_name)

  const text = [
    version.system_instruction && `SYSTEM INSTRUCTIONS\n${fill(version.system_instruction)}`,
    version.task_instruction && `TASK INSTRUCTIONS\n${fill(version.task_instruction)}`,
    version.dynamic_context && `CONTEXT\n${fill(version.dynamic_context)}`,
    version.restrictions && `RESTRICTIONS\n${fill(version.restrictions)}`,
  ].filter(Boolean).join('\n\n')

  return { resolved_prompt: text, values: supplied, missing_required: missing }
}

async function previewVersion(id, values) {
  return resolvePrompt(await getVersion(id), values)
}

/**
 * Runs the draft against test values and keeps the result.
 *
 * The model is not called from here yet — there is no studio inference endpoint
 * wired up — so this resolves the prompt, records what would be sent, and says
 * plainly that nothing was generated. That is more useful than a fabricated
 * response, and the row is the same shape a real run will write.
 */
async function testVersion(id, { values = {}, tested_by } = {}) {
  const version = await getVersion(id)
  const resolved = resolvePrompt(version, values)
  const ok = resolved.missing_required.length === 0
  const output = ok
    ? { status: 'resolved',
        note: 'Prompt resolved. No model call was made — connect the studio inference endpoint to generate output here.',
        model: { provider: version.provider, model: version.model_name,
                 temperature: version.temperature, max_tokens: version.max_tokens } }
    : { status: 'incomplete',
        note: `Missing required values: ${resolved.missing_required.join(', ')}` }

  const { rows } = await query(
    `INSERT INTO prompt_tests (prompt_version_id, input_data, output_data, resolved_prompt, status, tested_by)
     VALUES ($1,$2::jsonb,$3::jsonb,$4,$5,$6) RETURNING *`,
    [id, JSON.stringify(values), JSON.stringify(output), resolved.resolved_prompt,
     ok ? 'ok' : 'failed', tested_by || null])
  return { ...rows[0], ...resolved }
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

async function createModule({ name, key, description }) {
  const { rows } = await query(
    `INSERT INTO prompt_modules (name, key, description) VALUES ($1,$2,$3)
     ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
     RETURNING *`, [name, String(key).toUpperCase(), description || null])
  return rows[0]
}

module.exports = {
  listPrompts, getPrompt, createPrompt, updatePrompt,
  createVersion, getVersion, updateVersion, publishVersion, rollbackVersion, deleteVersion,
  listVariables, createVariable, updateVariable, deleteVariable,
  previewVersion, testVersion, listTests, resolvePrompt,
  listModules, createModule,
}
