const service = require('./production-artwork.service')
const { success, created } = require('../../utils/response')

async function mockups(req, res, next) { try { return success(res, await service.listMockups(req.query)) } catch (e) { next(e) } }
async function createMockup(req, res, next) { try { return created(res, await service.createMockup(req.body, req.user.id), 'Mockup created') } catch (e) { next(e) } }
async function createMaster(req, res, next) { try { return created(res, await service.createMaster(req.body, req.user.id), 'Master gang sheet created') } catch (e) { next(e) } }
async function createChild(req, res, next) { try { return created(res, await service.createChild(req.body, req.user.id), 'Child gang sheet created') } catch (e) { next(e) } }
async function addArtwork(req, res, next) { try { return success(res, await service.addArtworkToChild({ ...req.body, child_gangsheet_id: req.params.id }), 'Artwork added to child gang sheet') } catch (e) { next(e) } }
async function getMaster(req, res, next) { try { return success(res, await service.getMaster(req.params.id)) } catch (e) { next(e) } }
async function validateMaster(req, res, next) { try { return success(res, await service.validateMaster(req.params.id)) } catch (e) { next(e) } }

module.exports = { mockups, createMockup, createMaster, createChild, addArtwork, getMaster, validateMaster }
