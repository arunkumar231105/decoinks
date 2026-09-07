#!/usr/bin/env node
'use strict'

/**
 * The nine prompts the AI Studio actually runs, from the owner's list.
 *
 * Only the identity of each one is created — name, key, module, and the empty
 * v1.0.0 draft every prompt is born with. No instruction text is written: what
 * the model is told is the shop's own words, and inventing them would put
 * something into production that nobody wrote.
 *
 * Idempotent — a prompt whose key already exists is left exactly as it is.
 * Dry run by default. Pass --apply to write.
 */

require('dotenv').config()
const { pool } = require('../src/config/db')
const svc = require('../src/modules/prompts/prompts.service')

const APPLY = process.argv.includes('--apply')

const PROMPTS = [
  { name: 'Artwork Reconstruction', key: 'AIS.RECREATE.GENERATE',   module: 'Recreation'  },
  { name: 'Detect Artworks',        key: 'AIS.EXTRACT.DETECT',      module: 'Extraction'  },
  { name: 'Text Concept Collage',   key: 'AIS.TEXT.COLLAGE',        module: 'Concept'     },
  { name: 'Image + Text Design',    key: 'AIS.IMAGETEXT.GENERATE',  module: 'Concept'     },
  { name: 'Aspect Ratio Planning',  key: 'AIS.RATIO.PLAN',          module: 'Variations'  },
  { name: 'Colorway Generation',    key: 'AIS.COLORWAY.GENERATE',   module: 'Colorways'   },
  { name: 'Mockup Generation',      key: 'AIS.MOCKUP.GENERATE',     module: 'Mockups'     },
  { name: 'Print Ready QA',         key: 'AIS.PRINTREADY.QA',       module: 'Print Ready' },
  { name: 'Gangsheet Planning',     key: 'AIS.GANGSHEET.PLAN',      module: 'Gangsheet'   },
]

async function main() {
  console.log(APPLY ? '── APPLYING ──\n' : '── DRY RUN (add --apply to write) ──\n')

  const { rows: existing } = await pool.query(
    `SELECT prompt_key FROM prompts WHERE deleted_at IS NULL`)
  const known = new Set(existing.map(r => r.prompt_key))

  const modules = [...new Set(PROMPTS.map(p => p.module))]
  console.log(`Modules: ${modules.join(', ')}`)

  const todo = PROMPTS.filter(p => !known.has(p.key))
  console.log(`Prompts to create: ${todo.length} of ${PROMPTS.length}`)
  for (const p of todo) console.log(`   ${p.key.padEnd(24)} ${p.name}  [${p.module}]`)
  const skipped = PROMPTS.filter(p => known.has(p.key))
  for (const p of skipped) console.log(`   already on file, untouched: ${p.key}`)

  if (!APPLY) {
    console.log('\nNothing written. Re-run with --apply.')
    return pool.end()
  }

  const moduleIds = {}
  for (const name of modules) {
    const m = await svc.createModule({
      name,
      key: name.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
    })
    moduleIds[name] = m.id
  }

  for (const p of todo) {
    await svc.createPrompt({
      name: p.name,
      prompt_key: p.key,
      module_id: moduleIds[p.module],
      used_in: `AI Studio → ${p.module}`,
      created_by: null,
    })
    console.log(`   created ${p.key}`)
  }

  console.log(`\nWritten: ${modules.length} modules, ${todo.length} prompts, each with an empty v1.0.0 draft.`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
