'use strict'

const request  = require('supertest')
const app      = require('../../src/app')
const { pool } = require('../../src/config/db')
const { runMigrations, seedAdmin, truncateUsers } = require('./helpers')

let token
let promptId
let draftId

async function clearPrompts() {
  await pool.query('TRUNCATE TABLE prompt_output_files, ai_generation_logs, prompt_test_runs, prompt_test_inputs, prompt_tests, prompt_version_history, prompt_version_variables, prompt_variables_library, prompt_model_settings, prompt_variables, prompt_versions, prompts, prompt_modules CASCADE')
}

async function login() {
  const res = await request(app).post('/api/auth/login')
    .send({ email: 'admin@test.com', password: 'adminpass123' })
  return res.body.data.token
}

beforeAll(async () => {
  await runMigrations()
  await truncateUsers()
  await seedAdmin()
  await clearPrompts()
  token = await login()
})

afterAll(async () => {
  await clearPrompts()
  await truncateUsers()
  await pool.end()
})

const auth = r => r.set('Authorization', `Bearer ${token}`)

describe('Prompt Management', () => {
  test('a new prompt is born with an editable draft and a model to run it', async () => {
    const res = await auth(request(app).post('/api/prompts')).send({
      name: 'Artwork Reconstruction',
      prompt_key: 'AIS.RECREATE.GENERATE',
      description: 'Recreates supplied artwork as print-ready vector output',
      used_in: 'AI Studio → Reconstruction',
    })
    expect(res.status).toBe(201)
    promptId = res.body.data.id

    const one = await auth(request(app).get(`/api/prompts/${promptId}`))
    expect(one.status).toBe(200)
    expect(one.body.data.versions).toHaveLength(1)

    const version = one.body.data.versions[0]
    draftId = version.id
    expect(version.status).toBe('draft')
    expect(version.version_number).toBe('1')
    expect(version.version_seq).toBe(1)
    // The model belongs to the version, so a version can always be run.
    expect(version.provider).toBe('OpenAI')
    expect(version.model_name).toBe('GPT-5.5')
  })

  test('the same key cannot be claimed twice', async () => {
    const res = await auth(request(app).post('/api/prompts')).send({
      name: 'Another one', prompt_key: 'AIS.RECREATE.GENERATE',
    })
    expect(res.status).toBe(409)
  })

  test('instructions and model settings are saved together on the draft', async () => {
    const res = await auth(request(app).put(`/api/prompts/versions/${draftId}`)).send({
      system_instruction: 'You are a print production artwork specialist.',
      task_instruction: 'Recreate {{artwork_reference}} at {{output_dpi}} DPI.',
      restrictions: 'Never invent detail that is not in the reference.',
      change_summary: 'First working instruction set',
      model: { provider: 'OpenAI', model_name: 'GPT-5.5', temperature: 0.3, max_tokens: 4000 },
    })
    expect(res.status).toBe(200)
    expect(res.body.data.task_instruction).toContain('{{artwork_reference}}')
    expect(Number(res.body.data.temperature)).toBe(0.3)
    expect(res.body.data.max_tokens).toBe(4000)
  })

  test('variables are declared on the version and cannot repeat', async () => {
    const first = await auth(request(app).post(`/api/prompts/versions/${draftId}/variables`)).send({
      variable_name: 'artwork_reference', type: 'Image', required: true, source: 'Uploaded Asset',
      description: 'The customer-supplied artwork',
    })
    expect(first.status).toBe(201)

    const second = await auth(request(app).post(`/api/prompts/versions/${draftId}/variables`)).send({
      variable_name: 'output_dpi', type: 'Number', required: false, default_value: '300',
      source: 'System',
    })
    expect(second.status).toBe(201)

    const again = await auth(request(app).post(`/api/prompts/versions/${draftId}/variables`)).send({
      variable_name: 'artwork_reference', type: 'Image',
    })
    expect(again.status).toBe(409)

    const list = await auth(request(app).get(`/api/prompts/versions/${draftId}/variables`))
    expect(list.body.data).toHaveLength(2)
  })

  test('a preview fills in defaults and names what is still missing', async () => {
    const res = await auth(request(app).post(`/api/prompts/versions/${draftId}/preview`)).send({ values: {} })
    expect(res.status).toBe(200)
    // output_dpi has a default, so it resolves; artwork_reference is required and absent.
    expect(res.body.data.resolved_prompt).toContain('300 DPI')
    expect(res.body.data.resolved_prompt).toContain('{{artwork_reference}}')
    expect(res.body.data.missing_required).toEqual(['artwork_reference'])

    const filled = await auth(request(app).post(`/api/prompts/versions/${draftId}/preview`))
      .send({ values: { artwork_reference: 'ART-1042.png' } })
    expect(filled.body.data.resolved_prompt).toContain('ART-1042.png')
    expect(filled.body.data.missing_required).toEqual([])
  })

  test('publishing makes the draft live and closes it to editing', async () => {
    const res = await auth(request(app).post(`/api/prompts/versions/${draftId}/publish`))
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('production')

    const edit = await auth(request(app).put(`/api/prompts/versions/${draftId}`))
      .send({ task_instruction: 'sneaking a change into production' })
    expect(edit.status).toBe(409)

    const addVar = await auth(request(app).post(`/api/prompts/versions/${draftId}/variables`))
      .send({ variable_name: 'sneaky' })
    expect(addVar.status).toBe(409)

    const gone = await auth(request(app).delete(`/api/prompts/versions/${draftId}`))
    expect(gone.status).toBe(409)
  })

  let secondDraftId

  test('a new version clones the live one, variables and model included', async () => {
    const res = await auth(request(app).post(`/api/prompts/${promptId}/versions`))
      .send({ change_summary: 'Tighten the colour rules' })
    expect(res.status).toBe(201)
    secondDraftId = res.body.data.id
    expect(res.body.data.version_number).toBe('2')

    const v = await auth(request(app).get(`/api/prompts/versions/${secondDraftId}`))
    expect(v.body.data.system_instruction).toBe('You are a print production artwork specialist.')
    expect(v.body.data.variables).toHaveLength(2)
    expect(Number(v.body.data.temperature)).toBe(0.3)
  })

  test('only one draft may be open at a time', async () => {
    const res = await auth(request(app).post(`/api/prompts/${promptId}/versions`)).send({})
    expect(res.status).toBe(409)
  })

  test('publishing the second version archives the first, and rollback restores it', async () => {
    await auth(request(app).post(`/api/prompts/versions/${secondDraftId}/publish`)).expect(200)

    const after = await auth(request(app).get(`/api/prompts/${promptId}`))
    const live = after.body.data.versions.filter(v => v.status === 'production')
    expect(live).toHaveLength(1)
    expect(live[0].id).toBe(secondDraftId)
    expect(after.body.data.versions.find(v => v.id === draftId).status).toBe('archived')

    const back = await auth(request(app).post(`/api/prompts/versions/${draftId}/rollback`))
    expect(back.status).toBe(200)
    const rolled = await auth(request(app).get(`/api/prompts/${promptId}`))
    const nowLive = rolled.body.data.versions.filter(v => v.status === 'production')
    expect(nowLive).toHaveLength(1)
    expect(nowLive[0].id).toBe(draftId)
    // Nothing was destroyed by the rollback.
    expect(rolled.body.data.versions).toHaveLength(2)
  })

  test('a test run is recorded against the version', async () => {
    const res = await auth(request(app).post(`/api/prompts/versions/${draftId}/test`))
      .send({ values: { artwork_reference: 'ART-1042.png' } })
    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('ok')

    const missing = await auth(request(app).post(`/api/prompts/versions/${draftId}/test`)).send({ values: {} })
    expect(missing.body.data.status).toBe('failed')

    const history = await auth(request(app).get(`/api/prompts/versions/${draftId}/tests`))
    expect(history.body.data).toHaveLength(2)

    // Each test is kept as test → input → run, the run holding the exact text and settings.
    const { rows } = await pool.query(
      `SELECT r.status, r.resolved_prompt, r.settings_snapshot FROM prompt_test_runs r
        WHERE r.prompt_version_id = $1 ORDER BY r.created_at`, [draftId])
    expect(rows.map(r => r.status)).toEqual(['resolved', 'failed'])
    expect(rows[0].resolved_prompt).toContain('ART-1042.png')
    expect(rows[0].settings_snapshot.model_name).toBe('GPT-5.5')
  })

  test('a version under test can still be edited, and publishing freezes its variables', async () => {
    const made = await auth(request(app).post(`/api/prompts/${promptId}/versions`)).send({})
    expect(made.status).toBe(201)
    const vid = made.body.data.id
    expect(made.body.data.version_number).toBe('3')

    const toTesting = await auth(request(app).post(`/api/prompts/versions/${vid}/status`)).send({ status: 'testing' })
    expect(toTesting.status).toBe(200)
    expect(toTesting.body.data.status).toBe('testing')

    const edit = await auth(request(app).put(`/api/prompts/versions/${vid}`)).send({ notes: 'still under test' })
    expect(edit.status).toBe(200)

    // "production" is reached only by publishing.
    const cheat = await auth(request(app).post(`/api/prompts/versions/${vid}/status`)).send({ status: 'production' })
    expect(cheat.status).toBe(422)

    await auth(request(app).post(`/api/prompts/versions/${vid}/publish`)).expect(200)
    const v = await auth(request(app).get(`/api/prompts/versions/${vid}`))
    expect(v.body.data.published_by_name).toBe('Test Admin')
    expect(v.body.data.variables.every(x => x.frozen)).toBe(true)
    expect(v.body.data.history.map(h => h.to_status)).toEqual(['draft', 'testing', 'production'])

    // Editing the shared library afterwards does not change what the published version meant.
    await pool.query(`UPDATE prompt_variables_library SET default_value = '600' WHERE variable_key = 'output_dpi'`)
    const after = await auth(request(app).get(`/api/prompts/versions/${vid}`))
    expect(after.body.data.variables.find(x => x.variable_name === 'output_dpi').default_value).toBe('300')
  })

  test('an empty version cannot be published', async () => {
    const res = await auth(request(app).post('/api/prompts')).send({ name: 'Empty', prompt_key: 'AIS.TEST.EMPTY' })
    const one = await auth(request(app).get(`/api/prompts/${res.body.data.id}`))
    const pub = await auth(request(app).post(`/api/prompts/versions/${one.body.data.versions[0].id}/publish`))
    expect(pub.status).toBe(422)
  })

  test('a viewer may read the prompts but not change them', async () => {
    const bcrypt = require('bcryptjs')
    await pool.query(
      `INSERT INTO users (id, name, email, password, role)
       VALUES (uuid_generate_v4(), 'Test Viewer', 'viewer@test.com', $1, 'Viewer')
       ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, role = 'Viewer'`,
      [await bcrypt.hash('viewerpass123', 10)])
    const login = await request(app).post('/api/auth/login')
      .send({ email: 'viewer@test.com', password: 'viewerpass123' })
    const viewerToken = login.body.data.token

    const read = await request(app).get('/api/prompts').set('Authorization', `Bearer ${viewerToken}`)
    expect(read.status).toBe(200)
    expect(read.body.data).toHaveLength(2)

    const write = await request(app).post('/api/prompts').set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Not allowed', prompt_key: 'NOPE.KEY' })
    expect(write.status).toBe(403)
  })

  test('the module refuses anonymous callers', async () => {
    const res = await request(app).get('/api/prompts')
    expect(res.status).toBe(401)
  })

  describe('runtime API for apps', () => {
    const SECRET = 'test-service-secret-for-prompts'
    const svc = r => r.set('x-decoinks-sso-secret', SECRET)
    let single

    beforeAll(async () => {
      process.env.SERVICE_API_SECRET = SECRET
      const made = await auth(request(app).post('/api/prompts')).send({ name: 'Collage', prompt_key: 'AIS.TEST.COLLAGE' })
      const one = await auth(request(app).get(`/api/prompts/${made.body.data.id}`))
      single = one.body.data.versions[0].id
      await auth(request(app).put(`/api/prompts/versions/${single}`)).send({
        task_instruction: 'Make 8 styles of "{{text}}". Reply as {"n": 1}.\n  Keep spacing.  ',
        model: { provider: 'OpenAI', model_name: 'chatgpt-web' },
      }).expect(200)
      await auth(request(app).post(`/api/prompts/versions/${single}/variables`))
        .send({ variable_name: 'text', type: 'Text', required: true, source: 'UI Selection' }).expect(201)
    })

    test('refuses a caller without the service secret', async () => {
      expect((await request(app).get('/api/ai/prompts')).status).toBe(401)
      expect((await request(app).get('/api/ai/prompts').set('x-decoinks-sso-secret', 'wrong')).status).toBe(401)
    })

    test('a draft is never served', async () => {
      const res = await svc(request(app).get('/api/ai/prompts?keys=AIS.TEST.COLLAGE'))
      expect(res.status).toBe(200)
      expect(res.body.data.prompts).toHaveLength(0)
      expect(res.body.data.missing).toEqual(['AIS.TEST.COLLAGE'])
    })

    test('the live version is served word for word, with its variables and model', async () => {
      await auth(request(app).post(`/api/prompts/versions/${single}/publish`)).expect(200)
      const res = await svc(request(app).get('/api/ai/prompts/ais.test.collage'))
      expect(res.status).toBe(200)
      const p = res.body.data
      // A single filled section comes back exactly as written — no headings, no trimming.
      expect(p.text).toBe('Make 8 styles of "{{text}}". Reply as {"n": 1}.\n  Keep spacing.  ')
      expect(p.placeholders).toEqual(['text'])
      expect(p.variables[0]).toMatchObject({ key: 'text', required: true, source: 'UI Selection' })
      expect(p.model.model_key).toBe('chatgpt-web')
      expect(p.version.number).toBe(1)

      const missing = await svc(request(app).get('/api/ai/prompts/AIS.NOPE'))
      expect(missing.status).toBe(404)
    })

    test('runs are logged once per job and prompt, with their files', async () => {
      const body = {
        runs: [{
          prompt_key: 'AIS.TEST.COLLAGE', prompt_version_id: single, source_app: 'artwork-automation',
          external_ref: 'job-1', status: 'running', prompt_source: 'managed', provider: 'OpenAI', model: 'chatgpt-web',
          resolved_prompt: 'Make 8 styles of "HELLO".', input_variables: { text: 'HELLO' },
        }],
      }
      const first = await svc(request(app).post('/api/ai/generations')).send(body)
      expect(first.status).toBe(201)
      body.runs[0].status = 'success'
      body.runs[0].latency_ms = 42000
      body.runs[0].output_files = [{ file_name: 'job-1_final.png', file_url: '/api/output/job-1_final.png' }]
      const again = await svc(request(app).post('/api/ai/generations')).send(body)
      expect(again.body.data[0].id).toBe(first.body.data[0].id)

      const promptRow = await pool.query(`SELECT id FROM prompts WHERE prompt_key = 'AIS.TEST.COLLAGE'`)
      const list = await auth(request(app).get(`/api/prompts/${promptRow.rows[0].id}/generations`))
      expect(list.status).toBe(200)
      expect(list.body.data).toHaveLength(1)
      expect(list.body.data[0]).toMatchObject({ status: 'success', latency_ms: 42000, version_number: '1' })
      expect(list.body.data[0].files).toEqual([{ file_name: 'job-1_final.png', file_url: '/api/output/job-1_final.png' }])

      const bad = await svc(request(app).post('/api/ai/generations')).send({ runs: [{ prompt_key: 'X' }] })
      expect(bad.status).toBe(422)
    })
  })

  test('a bad prompt key is rejected before it reaches the database', async () => {
    const res = await auth(request(app).post('/api/prompts'))
      .send({ name: 'Spaces are not allowed', prompt_key: 'has spaces' })
    expect(res.status).toBe(422)
  })
})
