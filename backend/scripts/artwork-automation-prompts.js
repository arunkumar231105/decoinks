#!/usr/bin/env node
'use strict'

/**
 * Artwork Automation's prompts, moved into Prompt Management.
 *
 * Until now ChatGPT's instructions lived only in the automation's
 * config/workflows.py. This imports each prompt the automation actually runs,
 * WORD FOR WORD, as version 1 and publishes it, so the day the automation
 * starts reading from Decoinks it sends exactly what it sent before. Changing a
 * prompt from then on is a new version in Prompt Management, not a code change.
 *
 * Input is a JSON file of { TEMPLATE_NAME: python_template } exported from the
 * automation (see --from). Python placeholders {text} become {{text}}; doubled
 * literal braces become single ones.
 *
 * Idempotent: a prompt that already has a live version is left alone. The five
 * prompts created earlier from the owner's list (empty drafts) are filled in
 * rather than duplicated. Dry run by default; pass --apply to write.
 *
 *   node scripts/artwork-automation-prompts.js --from prompts.json [--apply]
 */

require('dotenv').config()
const fs = require('fs')
const { pool, query } = require('../src/config/db')
const svc = require('../src/modules/prompts/prompts.service')

const APPLY = process.argv.includes('--apply')
const fromArg = process.argv.indexOf('--from')
const FROM = fromArg > -1 ? process.argv[fromArg + 1] : null

const PLAN = [
  { name: 'TEXT_TURN_0',              key: 'AIS.TEXT.EXTRACT',                 title: 'Read Text From Image',          module: 'Concept',     used: 'Text designs · step 0, read the text' },
  { name: 'TEXT_TURN_1',              key: 'AIS.TEXT.COLLAGE',                 title: 'Text Concept Collage',          module: 'Concept',     used: 'Text designs · step 1, 8 typography styles' },
  { name: 'TEXT_TURN_2',              key: 'AIS.COLORWAY.GENERATE',            title: 'Colorway Generation',           module: 'Colorways',   used: 'Text designs · step 2, 8 colourways' },
  { name: 'TEXT_TURN_3',              key: 'AIS.TEXT.FINAL',                   title: 'Final Text Design',             module: 'Concept',     used: 'Text designs · step 3, final PNG' },
  { name: 'EXTRACT_CONTACT_SHEET',    key: 'AIS.EXTRACT.DETECT',               title: 'Detect Artworks',               module: 'Extraction',  used: 'Mockup extraction · contact sheet' },
  { name: 'EXTRACT_SINGLE',           key: 'AIS.EXTRACT.SINGLE',               title: 'Extract Single Design',         module: 'Extraction',  used: 'Mockup extraction · one design' },
  { name: 'ARTWORK_REGENERATE',       key: 'AIS.RECREATE.CLEANUP',             title: 'Artwork Cleanup',               module: 'Recreation',  used: 'Artwork generation · clean final' },
  { name: 'CUSTOM_RECONSTRUCT',       key: 'AIS.RECREATE.GENERATE',            title: 'Artwork Reconstruction',        module: 'Recreation',  used: 'Custom operations · Reconstruct' },
  { name: 'CUSTOM_REMOVE_BACKGROUND', key: 'AIS.PRINTREADY.REMOVE_BACKGROUND', title: 'Remove Background',             module: 'Print Ready', used: 'Custom operations · Remove Background' },
  { name: 'CUSTOM_HALO_REMOVAL',      key: 'AIS.PRINTREADY.HALO_REMOVAL',      title: 'Halo Removal',                  module: 'Print Ready', used: 'Custom operations · Halo Removal' },
  { name: 'CUSTOM_DETECT_OBJECTS',    key: 'AIS.COLORWAY.DETECT_OBJECTS',      title: 'Detect Recolourable Objects',   module: 'Colorways',   used: 'Custom operations · Change Object Colour, step A' },
  { name: 'CUSTOM_CHANGE_COLOR',      key: 'AIS.COLORWAY.CHANGE_COLOR',        title: 'Change Object Colour',          module: 'Colorways',   used: 'Custom operations · Change Object Colour, step B' },
  { name: 'CUSTOM_ASPECT_ADVICE',     key: 'AIS.RATIO.PLAN',                   title: 'Aspect Ratio Planning',         module: 'Variations',  used: 'Custom operations · Aspect Ratio, advice' },
  { name: 'CUSTOM_ASPECT_BASELINE',   key: 'AIS.RATIO.BASELINE',               title: 'Aspect Ratio Baseline',         module: 'Variations',  used: 'Custom operations · Aspect Ratio, clean baseline' },
  { name: 'CUSTOM_ASPECT_REGENERATE', key: 'AIS.RATIO.REGENERATE',             title: 'Aspect Ratio Regenerate',       module: 'Variations',  used: 'Custom operations · Aspect Ratio, regenerate' },
]

// What each placeholder means, where its value comes from, and its type.
const VARIABLES = {
  text:     { type: 'Text',   source: 'UI Selection',   description: 'The design text the designer typed or confirmed' },
  n:        { type: 'Number', source: 'UI Selection',   description: 'The design or style number the designer picked' },
  m:        { type: 'Number', source: 'UI Selection',   description: 'The colour variation number the designer picked' },
  row:      { type: 'Number', source: 'System',         description: 'Grid row of the chosen variation (1-based)' },
  col:      { type: 'Number', source: 'System',         description: 'Grid column of the chosen variation (1-based)' },
  width:    { type: 'Number', source: 'Uploaded Asset', description: 'Artwork width in pixels' },
  height:   { type: 'Number', source: 'Uploaded Asset', description: 'Artwork height in pixels' },
  ratio:    { type: 'Ratio',  source: 'Uploaded Asset', description: 'Aspect ratio, e.g. 177:248 (1 : 1.40)' },
  inches_w: { type: 'Number', source: 'System',         description: 'Print width in inches at the chosen DPI' },
  inches_h: { type: 'Number', source: 'System',         description: 'Print height in inches at the chosen DPI' },
  dpi:      { type: 'Number', source: 'UI Selection',   description: 'Print resolution in dots per inch' },
  changes:  { type: 'Text',   source: 'UI Selection',   description: 'The object → colour changes the designer chose' },
}

/** {text} → {{text}}, {{ → {, }} → }. Refuses anything str.format would not accept. */
function fromPythonTemplate(tpl) {
  let out = ''
  for (let i = 0; i < tpl.length; i++) {
    const c = tpl[i]
    if (c === '{') {
      if (tpl[i + 1] === '{') { out += '{'; i++; continue }
      const end = tpl.indexOf('}', i)
      const field = tpl.slice(i + 1, end)
      if (end < 0 || !/^[A-Za-z0-9_]+$/.test(field)) throw new Error(`Unsupported placeholder near "${tpl.slice(i, i + 20)}"`)
      out += `{{${field}}}`; i = end; continue
    }
    if (c === '}') {
      if (tpl[i + 1] === '}') { out += '}'; i++; continue }
      throw new Error(`Single "}" near "${tpl.slice(Math.max(0, i - 20), i + 1)}"`)
    }
    out += c
  }
  return out
}

async function moduleId(name) {
  const key = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  const { rows } = await query(`SELECT id FROM prompt_modules WHERE key = $1`, [key])
  if (rows[0]) return rows[0].id
  if (!APPLY) return null
  return (await svc.createModule({ name, key })).id
}

async function main() {
  if (!FROM) throw new Error('Pass --from <json> exported from the automation config/workflows.py')
  const source = JSON.parse(fs.readFileSync(FROM, 'utf8'))
  console.log(APPLY ? '── APPLYING ──\n' : '── DRY RUN (add --apply to write) ──\n')

  for (const item of PLAN) {
    const python = source[item.name]
    if (typeof python !== 'string' || !python.trim()) throw new Error(`${item.name} is missing from ${FROM}`)
    const text = fromPythonTemplate(python)
    const placeholders = [...new Set([...text.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)].map(m => m[1]))]
    for (const p of placeholders) if (!VARIABLES[p]) throw new Error(`${item.name}: no definition for {{${p}}}`)

    const { rows: existing } = await query(
      `SELECT id, production_version_id FROM prompts WHERE prompt_key = $1 AND deleted_at IS NULL`, [item.key])
    if (existing[0]?.production_version_id) {
      console.log(`  skip   ${item.key.padEnd(34)} already has a live version`)
      continue
    }
    console.log(`  ${existing[0] ? 'fill  ' : 'create'} ${item.key.padEnd(34)} ${String(text.length).padStart(5)} chars  vars: ${placeholders.join(', ') || '—'}`)
    if (!APPLY) continue

    let promptId = existing[0]?.id
    if (!promptId) {
      promptId = (await svc.createPrompt({
        name: item.title, prompt_key: item.key, module_id: await moduleId(item.module),
        used_in: `Artwork Automation → ${item.used}`,
      })).id
    } else {
      await svc.updatePrompt(promptId, { used_in: `Artwork Automation → ${item.used}` })
    }

    const prompt = await svc.getPrompt(promptId)
    let draftId = prompt.draft_version_id
    if (!draftId) draftId = (await svc.createVersion(promptId, { change_summary: 'Imported from Artwork Automation' })).id

    await svc.updateVersion(draftId, {
      task_instruction: text,
      change_summary: 'Imported word for word from Artwork Automation (config/workflows.py)',
      model: { provider: 'OpenAI', model_name: 'chatgpt-web', temperature: null, max_tokens: null, settings: {} },
    })
    const version = await svc.getVersion(draftId)
    const linked = new Set(version.variables.map(v => v.variable_name))
    for (const p of placeholders) {
      if (linked.has(p)) continue
      await svc.createVariable(draftId, { variable_name: p, required: true, ...VARIABLES[p] })
    }
    await svc.publishVersion(draftId, null)
  }

  // Proof: what the runtime now serves is the same text, character for character.
  if (APPLY) {
    const live = await svc.productionPrompts({ keys: PLAN.map(p => p.key) })
    let same = 0
    for (const item of PLAN) {
      const p = live.prompts.find(x => x.prompt_key === item.key)
      if (p && p.text === fromPythonTemplate(source[item.name])) same++
      else console.log(`  MISMATCH ${item.key}`)
    }
    console.log(`\nLive and identical to the automation's text: ${same}/${PLAN.length}`)
  }
}

main()
  .catch(e => { console.error(e.message); process.exitCode = 1 })
  .finally(() => pool.end())
