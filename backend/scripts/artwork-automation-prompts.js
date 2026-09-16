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
 * Input (--from) is either
 *   - a map { TEMPLATE_NAME: python_template } exported from the automation, or
 *   - the automation team's prompt export { prompts: [{ constant, template, active }] }.
 *     There, active=false means retired: the prompt is kept (text and history)
 *     but set to Archived, so no app is served it. A prompt left out of the
 *     file is not touched.
 * Python placeholders {text} become {{text}}; doubled literal braces become
 * single ones.
 *
 * Covers every prompt text in the automation (27): the 15 its screens send, the
 * 5 templates no screen sends today (3 extraction, Black Out, Half Tone), and the
 * edit-options base + 6 option blocks.
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
  // Replace the wording in a supplied design (from the automation team's export;
  // its code is not deployed yet, so nothing fetches these until it is).
  { name: 'TEXT_REPLACE_COLLAGE',     key: 'AIS.TEXT.REPLACE_COLLAGE',         title: 'Replace Text: 8 Variations',    module: 'Concept',     used: 'Text replace · step 1, 8 variations with the new wording' },
  { name: 'TEXT_REPLACE_FINAL',       key: 'AIS.TEXT.REPLACE_FINAL',           title: 'Replace Text: Final Artwork',   module: 'Concept',     used: 'Text replace · step 2, final artwork' },
  // Text designs with a client-supplied image: their own stage-1 collage, then the shared colour and final turns.
  { name: 'TEXT_IMAGE_ELEMENT_COLLAGE', key: 'AIS.TEXT.IMAGE_ELEMENT_COLLAGE', title: 'Text + Image: 8 Variations',   module: 'Concept',     used: 'Text designs · image element mode, step 1' },
  { name: 'TEXT_IMAGE_STYLE_COLLAGE',   key: 'AIS.TEXT.IMAGE_STYLE_COLLAGE',   title: 'Text Styled After Image: 8 Variations', module: 'Concept', used: 'Text designs · image style mode, step 1' },
  { name: 'CUSTOM_ASPECT_REGENERATE', key: 'AIS.RATIO.REGENERATE',             title: 'Aspect Ratio Regenerate',       module: 'Variations',  used: 'Custom operations · Aspect Ratio, regenerate' },
  // In the automation's code and kept here, but no screen sends them yet.
  { name: 'EXTRACT_BOXES',            key: 'AIS.EXTRACT.BOXES',                title: 'Detect Design Boxes (JSON)',    module: 'Extraction',  used: 'Extraction helper get_boxes · not used by a screen yet' },
  { name: 'EXTRACT_ARTWORKS',         key: 'AIS.EXTRACT.SEPARATE',             title: 'Extract Artworks Separately',   module: 'Extraction',  used: 'Extraction helper extract_artwork_images · not used by a screen yet' },
  { name: 'MOCKUP_REGENERATE',        key: 'AIS.EXTRACT.REGENERATE',           title: 'Regenerate From Mockup',        module: 'Extraction',  used: 'Mockup regenerate template · not used by a screen yet' },
  { name: 'CUSTOM_BLACK_OUT',         key: 'AIS.PRINTREADY.BLACK_OUT',         title: 'Black Out (ChatGPT wording)',   module: 'Print Ready', used: 'Custom operations · Black Out · now runs locally, wording kept' },
  { name: 'CUSTOM_HALF_TONE',         key: 'AIS.PRINTREADY.HALF_TONE',         title: 'Half Tone (ChatGPT wording)',   module: 'Print Ready', used: 'Custom operations · Half Tone · now runs locally, wording kept' },
  // The original edit-options job (API only): the base block, then one block per option.
  { name: 'BASE_INSTRUCTION',             key: 'AIS.EDIT.BASE',                title: 'Edit Options: Base Instruction', module: 'Edit Options', used: 'Edit-options job · base block (always first)' },
  { name: 'JOB_OPTION_TEXT_ONLY',         key: 'AIS.EDIT.TEXT_ONLY',           title: 'Edit Option: Text Only',        module: 'Edit Options', used: 'Edit-options job · option text_only' },
  { name: 'JOB_OPTION_REMOVE_BACKGROUND', key: 'AIS.EDIT.REMOVE_BACKGROUND',   title: 'Edit Option: Remove Background', module: 'Edit Options', used: 'Edit-options job · option remove_background' },
  { name: 'JOB_OPTION_CHANGE_BACKGROUND', key: 'AIS.EDIT.CHANGE_BACKGROUND',   title: 'Edit Option: Change Background', module: 'Edit Options', used: 'Edit-options job · option change_background' },
  { name: 'JOB_OPTION_BLUR_BACKGROUND',   key: 'AIS.EDIT.BLUR_BACKGROUND',     title: 'Edit Option: Blur Background',  module: 'Edit Options', used: 'Edit-options job · option blur_background' },
  { name: 'JOB_OPTION_RECOLOUR',          key: 'AIS.EDIT.RECOLOUR',            title: 'Edit Option: Recolour',         module: 'Edit Options', used: 'Edit-options job · option recolour' },
  { name: 'JOB_OPTION_UPSCALE_CLEANUP',   key: 'AIS.EDIT.UPSCALE_CLEANUP',     title: 'Edit Option: Upscale Cleanup',  module: 'Edit Options', used: 'Edit-options job · option upscale_cleanup' },
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
  value:    { type: 'Text',   source: 'UI Selection',   description: 'The value entered for this option (background or colour)' },
  new_text: { type: 'Text',   source: 'UI Selection',   description: 'The wording that replaces the text in the supplied design' },
  target_clause: { type: 'Text', source: 'System',      description: 'Sentence naming which text in the design to replace (may be empty)' },
}

// The export names the custom operations by their list entry; these are the same texts.
const EXPORT_ALIASES = {
  "CUSTOM_OPERATIONS['reconstruct']": 'CUSTOM_RECONSTRUCT',
  "CUSTOM_OPERATIONS['remove_background']": 'CUSTOM_REMOVE_BACKGROUND',
  "CUSTOM_OPERATIONS['halo_removal']": 'CUSTOM_HALO_REMOVAL',
  "CUSTOM_OPERATIONS['aspect_ratio']": 'CUSTOM_ASPECT_ADVICE',
}

/** { name: { template, active } } from either input shape. */
function readSource(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const out = {}
  if (Array.isArray(data.prompts)) {
    for (const row of data.prompts) {
      const name = EXPORT_ALIASES[row.constant] ?? row.constant
      if (out[name] && out[name].template !== row.template) throw new Error(`${name} appears twice with different text`)
      out[name] = { template: row.template, active: row.active !== false }
    }
  } else {
    // This shape says nothing about retirement, so it never changes a prompt's status.
    for (const [name, template] of Object.entries(data)) out[name] = { template, active: null }
  }
  return out
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
  const source = readSource(FROM)
  console.log(APPLY ? '── APPLYING ──\n' : '── DRY RUN (add --apply to write) ──\n')

  for (const item of PLAN) {
    if (!source[item.name]) { console.log(`  —      ${item.key.padEnd(34)} not in this file, left as it is`); continue }
    const python = source[item.name].template
    if (typeof python !== 'string' || !python.trim()) throw new Error(`${item.name} has no text in ${FROM}`)
    const text = fromPythonTemplate(python)
    const placeholders = [...new Set([...text.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)].map(m => m[1]))]
    for (const p of placeholders) if (!VARIABLES[p]) throw new Error(`${item.name}: no definition for {{${p}}}`)

    const wantStatus = source[item.name].active === null ? null : source[item.name].active ? 'Active' : 'Archived'
    const { rows: existing } = await query(
      `SELECT id, production_version_id, status FROM prompts WHERE prompt_key = $1 AND deleted_at IS NULL`, [item.key])
    if (existing[0]?.production_version_id) {
      if (!wantStatus || existing[0].status === wantStatus) {
        console.log(`  skip   ${item.key.padEnd(34)} already has a live version (${existing[0].status})`)
      } else {
        console.log(`  status ${item.key.padEnd(34)} ${existing[0].status} → ${wantStatus}`)
        if (APPLY) await svc.updatePrompt(existing[0].id, { status: wantStatus })
      }
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
    if (wantStatus && wantStatus !== 'Active') {
      await svc.updatePrompt(promptId, { status: wantStatus })
      console.log(`         ${item.key.padEnd(34)} published and set ${wantStatus} (retired in the file)`)
    }
  }

  // Proof: apps are served exactly the active prompts, character for character,
  // and none of the retired ones.
  if (APPLY) {
    const inFile = PLAN.filter(p => source[p.name])
    const live = await svc.productionPrompts({ keys: inFile.map(p => p.key) })
    let same = 0, retired = 0, bad = 0
    for (const item of inFile) {
      const p = live.prompts.find(x => x.prompt_key === item.key)
      const status = (await query(`SELECT status FROM prompts WHERE prompt_key = $1`, [item.key])).rows[0]?.status
      if (source[item.name].active === false && status !== 'Archived') { bad++; console.log(`  NOT ARCHIVED ${item.key}`) }
      if (status === 'Active') {
        if (p && p.text === fromPythonTemplate(source[item.name].template)) same++
        else { bad++; console.log(`  MISMATCH ${item.key}`) }
      } else if (p) { bad++; console.log(`  STILL SERVED ${item.key}`) } else retired++
    }
    console.log(`\nServed and identical: ${same} · retired and not served: ${retired} · problems: ${bad} (of ${inFile.length} in the file)`)
    if (bad) process.exitCode = 1
  }
}

main()
  .catch(e => { console.error(e.message); process.exitCode = 1 })
  .finally(() => pool.end())
