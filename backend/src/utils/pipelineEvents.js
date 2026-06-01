const { query } = require('../config/db')

async function logPipelineEvent({ event_type, source_table, source_id, target_table = null, target_id = null, triggered_by = null, metadata = null }) {
  await query(
    `INSERT INTO pipeline_events
       (event_type, source_table, source_id, target_table, target_id, triggered_by, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [event_type, source_table, source_id, target_table, target_id, triggered_by, metadata ? JSON.stringify(metadata) : null]
  ).catch(() => {})
}

module.exports = { logPipelineEvent }
