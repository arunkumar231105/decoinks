'use strict'

const request  = require('supertest')
const app      = require('../../src/app')
const { pool } = require('../../src/config/db')
const { runMigrations, seedAdmin, truncateUsers } = require('./helpers')

let token
let promptId
let draftId

async function clearPrompts() {
  await pool.query('TRUNCATE TABLE ai_generation_logs, prompt_tests, prompt_model_settings, prompt_variables, prompt_versions, prompts, prompt_modules CASCADE')
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
    expect(version.version_number).toBe('1.0.0')
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
    expect(res.body.data.version_number).toBe('1.1.0')

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
    expect(read.body.data).toHaveLength(1)

    const write = await request(app).post('/api/prompts').set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Not allowed', prompt_key: 'NOPE.KEY' })
    expect(write.status).toBe(403)
  })

  test('the module refuses anonymous callers', async () => {
    const res = await request(app).get('/api/prompts')
    expect(res.status).toBe(401)
  })

  test('a bad prompt key is rejected before it reaches the database', async () => {
    const res = await auth(request(app).post('/api/prompts'))
      .send({ name: 'Spaces are not allowed', prompt_key: 'has spaces' })
    expect(res.status).toBe(422)
  })
})
