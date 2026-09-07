const svc = require('./prompts.service')
const { success } = require('../../utils/response')

const actor = req => req.user?.id ?? null

const handle = fn => async (req, res, next) => {
  try { await fn(req, res) } catch (err) { next(err) }
}

module.exports = {
  listModules: handle(async (req, res) => success(res, await svc.listModules())),
  createModule: handle(async (req, res) =>
    success(res, await svc.createModule(req.body), 'Module created', 201)),

  list: handle(async (req, res) => success(res, await svc.listPrompts(req.query))),
  getOne: handle(async (req, res) => success(res, await svc.getPrompt(req.params.id))),
  create: handle(async (req, res) =>
    success(res, await svc.createPrompt({ ...req.body, created_by: actor(req) }), 'Prompt created', 201)),
  update: handle(async (req, res) =>
    success(res, await svc.updatePrompt(req.params.id, req.body), 'Prompt updated')),

  createVersion: handle(async (req, res) =>
    success(res, await svc.createVersion(req.params.id, { ...req.body, created_by: actor(req) }),
      'New draft version created', 201)),
  getVersion: handle(async (req, res) => success(res, await svc.getVersion(req.params.id))),
  updateVersion: handle(async (req, res) =>
    success(res, await svc.updateVersion(req.params.id, req.body), 'Version saved')),
  publishVersion: handle(async (req, res) =>
    success(res, await svc.publishVersion(req.params.id, actor(req)), 'Version published to production')),
  rollbackVersion: handle(async (req, res) =>
    success(res, await svc.rollbackVersion(req.params.id, actor(req)), 'Rolled back to this version')),
  deleteVersion: handle(async (req, res) =>
    success(res, await svc.deleteVersion(req.params.id), 'Draft deleted')),

  listVariables: handle(async (req, res) => success(res, await svc.listVariables(req.params.id))),
  createVariable: handle(async (req, res) =>
    success(res, await svc.createVariable(req.params.id, req.body), 'Variable added', 201)),
  updateVariable: handle(async (req, res) =>
    success(res, await svc.updateVariable(req.params.id, req.body), 'Variable updated')),
  deleteVariable: handle(async (req, res) =>
    success(res, await svc.deleteVariable(req.params.id), 'Variable removed')),

  preview: handle(async (req, res) =>
    success(res, await svc.previewVersion(req.params.id, req.body?.values ?? {}))),
  test: handle(async (req, res) =>
    success(res, await svc.testVersion(req.params.id, { values: req.body?.values ?? {}, tested_by: actor(req) }),
      'Test run recorded')),
  listTests: handle(async (req, res) => success(res, await svc.listTests(req.params.id))),
}
