const { query, getClient } = require('../../config/db')

function error(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }) }

async function listMockups({ artwork_id = '', artwork_version_id = '' } = {}) {
  const params = []
  const where = []
  if (artwork_id) { params.push(artwork_id); where.push(`m.artwork_id=$${params.length}`) }
  if (artwork_version_id) { params.push(artwork_version_id); where.push(`m.artwork_version_id=$${params.length}`) }
  const { rows } = await query(`SELECT m.*,a.artwork_no,a.name AS artwork_name,av.version_no
    FROM mockup_versions m JOIN artworks a ON a.id=m.artwork_id
    JOIN artwork_versions av ON av.id=m.artwork_version_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.created_at DESC`, params)
  return rows
}

async function createMockup(data, userId) {
  const { artwork_id, artwork_version_id } = data
  const valid = await query(`SELECT 1 FROM artwork_versions WHERE id=$1 AND artwork_id=$2`, [artwork_version_id, artwork_id])
  if (!valid.rows[0]) throw error('Artwork version does not belong to artwork', 422)
  const { rows } = await query(`INSERT INTO mockup_versions
    (artwork_id,artwork_version_id,mockup_no,apparel_type,apparel_color,apparel_size,
     artwork_width_in,artwork_height_in,mockup_type,file_name,storage_provider,relative_path,
     nextcloud_file_id,thumbnail_path,file_format,file_size_bytes,production_ready,
     customer_approval_status,created_by,notes)
    VALUES ($1,$2,COALESCE(NULLIF($3,''),'MO-'||LPAD(nextval('design_task_no_seq')::text,6,'0')),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    RETURNING *`, [artwork_id, artwork_version_id, data.mockup_no || '', data.apparel_type || null,
    data.apparel_color || null, data.apparel_size || null, data.artwork_width_in || null,
    data.artwork_height_in || null, data.mockup_type || 'Single', data.file_name,
    data.storage_provider || 'Nextcloud', data.relative_path, data.nextcloud_file_id || null,
    data.thumbnail_path || null, data.file_format || null, data.file_size_bytes || 0,
    Boolean(data.production_ready), data.customer_approval_status || 'Pending', userId || null, data.notes || null])
  return rows[0]
}

async function createMaster(data, userId) {
  const { rows } = await query(`INSERT INTO master_gangsheets
    (master_gangsheet_no,sales_order_id,purchase_order_id,status,total_unique_artworks,total_quantity,
     number_of_child_gangsheets,file_name,storage_provider,relative_path,nextcloud_file_id,width_in,length_in,created_by,notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
  [data.master_gangsheet_no, data.sales_order_id || null, data.purchase_order_id || null,
    data.status || 'Draft', data.total_unique_artworks || 0, data.total_quantity || 0,
    data.number_of_child_gangsheets || 0, data.file_name || null, data.storage_provider || 'Nextcloud',
    data.relative_path || null, data.nextcloud_file_id || null, data.width_in || null, data.length_in || null,
    userId || null, data.notes || null])
  return rows[0]
}

async function createChild(data, userId) {
  const { rows } = await query(`INSERT INTO child_gangsheets
    (master_gangsheet_id,child_no,version_no,version_type,file_name,storage_provider,relative_path,
     nextcloud_file_id,thumbnail_path,file_format,width_in,length_in,width_px,height_px,dpi,file_size_bytes,
     created_by,notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
  [data.master_gangsheet_id, data.child_no, data.version_no || 1, data.version_type || 'Working', data.file_name,
    data.storage_provider || 'Nextcloud', data.relative_path, data.nextcloud_file_id || null, data.thumbnail_path || null,
    data.file_format || null, data.width_in, data.length_in, data.width_px || null, data.height_px || null,
    data.dpi || null, data.file_size_bytes || 0, userId || null, data.notes || null])
  await query(`UPDATE master_gangsheets SET number_of_child_gangsheets = GREATEST(number_of_child_gangsheets,$2), updated_at=NOW() WHERE id=$1`, [data.master_gangsheet_id, data.child_no])
  return rows[0]
}

async function addArtworkToChild(data) {
  const valid = await query(`SELECT 1 FROM artwork_versions WHERE id=$1`, [data.artwork_version_id])
  if (!valid.rows[0]) throw error('Artwork version not found', 404)
  const { rows } = await query(`INSERT INTO gangsheet_artworks
    (child_gangsheet_id,artwork_version_id,sales_order_item_id,purchase_order_item_id,quantity,print_width_in,print_height_in)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (child_gangsheet_id,artwork_version_id) DO UPDATE SET quantity=EXCLUDED.quantity,
      sales_order_item_id=EXCLUDED.sales_order_item_id,purchase_order_item_id=EXCLUDED.purchase_order_item_id,
      print_width_in=EXCLUDED.print_width_in,print_height_in=EXCLUDED.print_height_in
    RETURNING *`, [data.child_gangsheet_id, data.artwork_version_id, data.sales_order_item_id || null,
    data.purchase_order_item_id || null, data.quantity, data.print_width_in || null, data.print_height_in || null])
  await query(`UPDATE child_gangsheets c SET total_unique_artworks=(SELECT COUNT(*) FROM gangsheet_artworks g WHERE g.child_gangsheet_id=c.id),
      total_quantity=(SELECT COALESCE(SUM(quantity),0) FROM gangsheet_artworks g WHERE g.child_gangsheet_id=c.id)
    WHERE c.id=$1`, [data.child_gangsheet_id])
  return rows[0]
}

async function getMaster(id) {
  const master = await query(`SELECT * FROM master_gangsheets WHERE id=$1`, [id])
  if (!master.rows[0]) throw error('Master gang sheet not found', 404)
  const children = await query(`SELECT * FROM child_gangsheets WHERE master_gangsheet_id=$1 ORDER BY child_no,version_no`, [id])
  const details = await query(`SELECT g.*,av.artwork_id,av.version_no,a.artwork_no,a.name
    FROM gangsheet_artworks g JOIN artwork_versions av ON av.id=g.artwork_version_id
    JOIN artworks a ON a.id=av.artwork_id
    JOIN child_gangsheets c ON c.id=g.child_gangsheet_id WHERE c.master_gangsheet_id=$1
    ORDER BY c.child_no,a.artwork_no`, [id])
  return { ...master.rows[0], children: children.rows, artwork_details: details.rows }
}

async function validateMaster(id) {
  const master = await getMaster(id)
  const perArtwork = {}
  for (const row of master.artwork_details) perArtwork[row.artwork_id] = (perArtwork[row.artwork_id] || 0) + Number(row.quantity)
  const childQuantity = master.artwork_details.reduce((sum, row) => sum + Number(row.quantity), 0)
  return { master_id: id, master_total_quantity: Number(master.total_quantity), child_total_quantity: childQuantity,
    quantity_match: Number(master.total_quantity) === childQuantity, artwork_totals: perArtwork }
}

module.exports = { listMockups, createMockup, createMaster, createChild, addArtworkToChild, getMaster, validateMaster }
