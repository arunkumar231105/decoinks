#!/usr/bin/env node
/**
 * Finalize the DTF sales orders against the TSI sheet (Apr–Aug 2026).
 *
 * The sheet is 88 rows: PO sequence 01…89 with 22 and 48 never issued, and
 * TSI 260604-21 appearing twice (the second is the free re-run). Those 88 rows
 * are the system of record for this batch; SHEET below is a verbatim transcript
 * of them, so every figure written here traces to a line the owner supplied.
 *
 * WHAT THIS FIXES
 *
 * 1. MONEY. Every order, invoice and PO in this batch stored the grand total in
 *    `subtotal`, because calcTotals folded shipping into the subtotal before
 *    computing the total. The stored totals are right; the subtotals are the
 *    total minus nothing. This resets subtotal to the product amount and leaves
 *    total alone, so subtotal + shipping = total for all 88. The four rows that
 *    were billed shipping-only (06, 14, 16, 17) also had their PO shipping and
 *    grand total sitting at zero; those get the sheet's $10.
 *
 * 2. MISSING RECORDS. Five POs and eight order chains were never imported —
 *    the duplicate 21, the combined-billing rows 64/65/67, and 53, 77, 88, 89.
 *    Each gets the same Customer → Quotation → Order → Invoice → PO chain the
 *    earlier TSI batches use, with a payment only where there is money.
 *
 * 3. ORD-2026-0076 is TSI 260808-78, keyed in by hand on 08-Aug before the sheet
 *    arrived (see import-tsi-po-tracker-aug-2026-75-88.js, which spotted it and
 *    deliberately left the money alone). It is linked to PO-2026-0081 and both
 *    are corrected to the sheet's $68 + $18 = $86.
 *
 * 4. NOT IN THE SHEET. ORD-2026-0084, ORD-2026-0098 and PO-2026-0097 have no TSI
 *    reference and match no row. Owner-approved soft delete. Neither order has a
 *    payments-ledger entry, so nothing is orphaned. Noted for the record:
 *    ORD-2026-0098 ($124 total less $25 shipping = $99 product) looks like a
 *    hand-keyed TSI 260818-89, whose sheet product amount is also $99; the
 *    shipping differs ($25 vs $26), so 89 is rebuilt from the sheet instead of
 *    being inferred onto this row.
 *
 * 5. The nine TS-PA-* purchase orders are custom t-shirt work that was typed as
 *    `gangsheet`. They are not DTF; they are retyped to `apparel` and kept, and
 *    are excluded from the DTF counts everywhere as a result.
 *
 * 6. NOTES are cleared on all 88 DTF orders (owner's instruction) and print_type
 *    is stamped so a DTF order can be told from customer apparel without
 *    inferring it. TSI 260808-77 arrived with no print type and keeps none.
 *
 * WHAT IS NOT TOUCHED: the payments ledger, invoice amount_paid / balance_due,
 * document numbering for existing rows, and every order outside this batch.
 *
 * Idempotent: keyed on source_po_number / source_entry_key, so a second run is
 * a no-op. Runs in one transaction and rolls back on any error.
 *
 * Usage:
 *   node backend/scripts/finalize-dtf-sales-orders.js            (dry-run, default)
 *   node backend/scripts/finalize-dtf-sales-orders.js --apply
 */
const { Pool } = require('pg')

const APPLY = process.argv.includes('--apply')
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Export it first, for example:\n' +
    '  export DATABASE_URL=postgresql://postgres:<password>@localhost:5435/decoinks_db')
  process.exit(1)
}

const SOURCE_SYSTEM = 'decoinks_dtf_sheet_reconcile_2026'
const VENDOR_NAME   = 'TEXSTONE INC'
const ENTRY_DATE    = '2026-08-21'
const DTF_PRINT     = 'DTF Transfers'

// Records with no TSI reference and no matching sheet row (owner-approved).
const ORPHAN_ORDERS = ['ORD-2026-0084', 'ORD-2026-0098']
const ORPHAN_POS    = ['PO-2026-0097']

// Custom t-shirt POs mis-typed as gangsheet; retyped to apparel, kept.
const TSHIRT_POS = ['PO-2026-0010','PO-2026-0011','PO-2026-0014','PO-2026-0017','PO-2026-0020',
                    'PO-2026-0024','PO-2026-0025','PO-2026-0029','PO-2026-0030']

// TSI 260808-78 was hand-keyed as this order before the sheet arrived.
const HANDKEYED = { order: 'ORD-2026-0076', po: 'PO-2026-0081', sheet: 'TSI 260808-78' }

// Addresses for the rows that need a chain built. Split by hand from the sheet
// and checked against the customer record; nothing is parsed at write time.
const CUSTOMER_BY_SHEET_NAME = {
  'Mery Garcia':      'CUST-2026-0004',
  'Robert Farrar':    'CUST-2026-0042',   // the record carrying the trading history
  'ROBERT FARRAR':    'CUST-2026-0042',
  'Samuel Ngwamukie': 'CUST-2026-0049',
}
const ADDRESSES = {
  'CUST-2026-0004': { line1: 'Si 525 East 25th Street', city: 'Larose',        state: 'LA', zip: '70373' },
  'CUST-2026-0042': { line1: '748 Alcovy Mill Park',    city: 'Lawrenceville', state: 'GA', zip: '30045' },
  'CUST-2026-0049': { line1: '236 Red Cedar Way',       city: 'Fuquay-Varina', state: 'NC', zip: '27526' },
}

// ── The sheet, verbatim (88 rows) ────────────────────────────────────────────
// `dup` marks the second TSI 260604-21 row. `product` is the sheet's product
// amount, `ship` its shipping, `total` its total. Row 24 lists its product
// amount in the Total column with shipping marked "Free"; it is read that way.
const SHEET = [
  { po: 'TSI 260421-01',   dup: false, po_date: '2026-04-21', dispatch: '2026-04-21', customer: 'Karen Mullen',          gangsheets: 1,    artworks: 3,     width: '22',  lengths: 'W21.6/H24.7',                                             product:    20.00, ship:  10.10, total:    30.10, print_type: 'DTF Transfers' },
  { po: 'TSI 260421-02',   dup: false, po_date: '2026-04-21', dispatch: '2026-04-21', customer: 'Dannyboy',              gangsheets: 1,    artworks: 20,    width: '22',  lengths: 'W19.1/H49.0',                                             product:    30.00, ship:  10.00, total:    40.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260424-03',   dup: false, po_date: '2026-04-24', dispatch: '2026-04-24', customer: 'Walby Vellon',          gangsheets: 1,    artworks: 9,     width: '22',  lengths: 'W21.2/H60.6',                                             product:    36.85, ship:  10.00, total:    46.85, print_type: 'DTF Transfers' },
  { po: 'TSI 260427-04',   dup: false, po_date: '2026-04-27', dispatch: '2026-04-27', customer: 'Erica Livingston',      gangsheets: 1,    artworks: 80,    width: '22',  lengths: 'W21.7/H50.05',                                            product:    40.99, ship:  10.00, total:    50.99, print_type: 'DTF Transfers' },
  { po: 'TSI 260427-05',   dup: false, po_date: '2026-04-27', dispatch: '2026-04-27', customer: 'Abdiel Castro',         gangsheets: 1,    artworks: 10,    width: '22',  lengths: 'W20.2/H75.5',                                             product:    89.00, ship:  10.10, total:    99.10, print_type: 'DTF Transfers' },
  { po: 'TSI 260427-06',   dup: false, po_date: '2026-04-27', dispatch: '2026-04-27', customer: 'Dannyboy',              gangsheets: 1,    artworks: 20,    width: '22',  lengths: 'W21.5/H41.0',                                             product:     0.00, ship:  10.00, total:    10.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260428-07',   dup: false, po_date: '2026-04-28', dispatch: '2026-04-28', customer: 'Walby Vellon',          gangsheets: 1,    artworks: 17,    width: '22',  lengths: 'W21.3/H167.1',                                            product:    83.00, ship:  10.00, total:    93.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260428-08',   dup: false, po_date: '2026-04-28', dispatch: '2026-04-28', customer: 'Jaysin Julios',         gangsheets: 1,    artworks: 15,    width: '22',  lengths: 'W21.5/H108.9',                                            product:    78.87, ship:  10.00, total:    88.87, print_type: 'DTF Transfers' },
  { po: 'TSI 260429-09',   dup: false, po_date: '2026-04-29', dispatch: '2026-04-29', customer: 'Michael Sanchez',       gangsheets: 4,    artworks: 242,   width: '22',  lengths: '01 W21.6/H198.7; 02 W21.6/H198.7; 03 W21.6/H198.7; 04 W21.6/H155.0', product:   181.00, ship:  10.00, total:   191.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260506-10',   dup: false, po_date: '2026-05-06', dispatch: '2026-05-06', customer: 'Travis Osborne',        gangsheets: 1,    artworks: 6,     width: '22',  lengths: 'W18.1/H26.8',                                             product:    10.00, ship:  10.00, total:    20.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260507-11',   dup: false, po_date: '2026-05-07', dispatch: '2026-05-07', customer: 'Tracy Machado',         gangsheets: 1,    artworks: 6,     width: '22',  lengths: 'W21.2/H33.1',                                             product:    10.00, ship:  10.00, total:    20.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260511-12',   dup: false, po_date: '2026-05-11', dispatch: '2026-05-11', customer: 'Raymond Mitchell',      gangsheets: 2,    artworks: 60,    width: '22',  lengths: '01 W21.1/H199.4; 02 W21.1/H64.8',                         product:   120.00, ship:  10.00, total:   130.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260511-13',   dup: false, po_date: '2026-05-11', dispatch: '2026-05-11', customer: 'Karen Mullen',          gangsheets: 1,    artworks: 40,    width: '22',  lengths: '01 W21.4/H165.1',                                         product:    43.00, ship:  10.00, total:    53.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260513-14',   dup: false, po_date: '2026-05-13', dispatch: '2026-05-13', customer: 'Walby Wellon',          gangsheets: 2,    artworks: 24,    width: '22',  lengths: '01 W21.5/H189.1; 02 W20.6/H24.9',                         product:     0.00, ship:  10.00, total:    10.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260517-15',   dup: false, po_date: '2026-05-17', dispatch: '2026-05-13', customer: 'Jaysin Julios',         gangsheets: 1,    artworks: 36,    width: '22',  lengths: '01 W21.3/H197.8',                                         product:   140.00, ship:  10.00, total:   150.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260519-16',   dup: false, po_date: '2026-05-19', dispatch: '2026-05-07', customer: 'Tracy Machado',         gangsheets: 6,    artworks: 200,   width: '22',  lengths: 'W21.2/H33.1',                                             product:     0.00, ship:  10.00, total:    10.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260525-17',   dup: false, po_date: '2026-05-26', dispatch: '2026-05-07', customer: 'Walby Wellon',          gangsheets: 2,    artworks: 17,    width: '22',  lengths: '01 W22/H113.97; 02 W22/H44.01',                           product:     0.00, ship:  10.00, total:    10.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260527-18',   dup: false, po_date: '2026-05-27', dispatch: '2026-05-27', customer: 'IVY TORRES',            gangsheets: 5,    artworks: 1000,  width: '22',  lengths: '01 W22/H118.30; 02 W22/H118.30; 03 W22/H100.64; 04 W22/H116.74; 05 W22/H5.86', product:   180.00, ship:  10.00, total:   190.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260529-19',   dup: false, po_date: '2026-05-29', dispatch: '2026-05-29', customer: 'Dannyboy',              gangsheets: 1,    artworks: 4,     width: '22',  lengths: '01 W22/H21.5',                                            product:    17.00, ship:  10.00, total:    27.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260601-20',   dup: false, po_date: '2026-06-01', dispatch: '2026-06-01', customer: 'Jaysin Julios',         gangsheets: 2,    artworks: 76,    width: '22',  lengths: '01 W22/H199.3; 02 W22/H96',                               product:   239.50, ship:  10.00, total:   249.50, print_type: 'DTF Transfers' },
  { po: 'TSI 260604-21',   dup: false, po_date: '2026-06-04', dispatch: '2026-06-04', customer: 'Mery Garcia',           gangsheets: 1,    artworks: 15,    width: '22',  lengths: '01 W21.7/H83.0',                                          product:    70.00, ship:  10.00, total:    80.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260604-21b',  dup: true,  po_date: '2026-06-04', dispatch: '2026-06-04', customer: 'Mery Garcia',           gangsheets: 1,    artworks: 15,    width: '22',  lengths: '01 W21.7/H83.0',                                          product:     0.00, ship:  10.00, total:    10.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260615-23',   dup: false, po_date: '2026-06-15', dispatch: '2026-06-15', customer: 'Tanya Bates',           gangsheets: 1,    artworks: 16,    width: '22',  lengths: '01 W22/H97.5',                                            product:    55.00, ship:  10.00, total:    65.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260615-24',   dup: false, po_date: '2026-06-15', dispatch: '2026-06-15', customer: 'Brandy Burgett',        gangsheets: 8,    artworks: 140,   width: '22',  lengths: '01 W22/H173.8; 02 W22/H184.0; 03 W22/H170.0; 04 W22/H158.4; 05 W22/H173.7; 06 W22/H188.6; 07 W22/H184.7; 08 W22/H187.8', product:   600.00, ship:   0.00, total:   600.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260616-25',   dup: false, po_date: '2026-06-16', dispatch: '2026-06-16', customer: 'Jaysin Julios',         gangsheets: 1,    artworks: 36,    width: '22',  lengths: '01 W22/H186.5',                                           product:    80.00, ship:  10.00, total:    90.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260616-26',   dup: false, po_date: '2026-06-16', dispatch: '2026-06-16', customer: 'Kyle Morris',           gangsheets: 3,    artworks: 57,    width: '22',  lengths: '01 W22/H58.7; 02 W22/H61.2; 03 W22/H114.1',               product:    85.00, ship:  15.00, total:   100.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260616-27',   dup: false, po_date: '2026-06-16', dispatch: '2026-06-16', customer: 'Sherry Buck',           gangsheets: 1,    artworks: 8,     width: '22',  lengths: '01 W22/H103.7',                                           product:    50.00, ship:  15.00, total:    65.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260618-28',   dup: false, po_date: '2026-06-18', dispatch: '2026-06-18', customer: 'Bashar Mamlouk',        gangsheets: 4,    artworks: 300,   width: '22',  lengths: '01 W22/H193.9; 02 W22/H193.9; 03 W22/H193.9; 04 W22/H193.5', product:   285.00, ship:  15.00, total:   300.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260621-29',   dup: false, po_date: '2026-06-21', dispatch: '2026-06-21', customer: 'Christopher Ferguson',  gangsheets: 1,    artworks: 10,    width: '22',  lengths: '01 W22/H126.0',                                           product:    75.00, ship:  15.00, total:    90.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260621-30',   dup: false, po_date: '2026-06-21', dispatch: '2026-06-21', customer: 'Bashar Mamlouk',        gangsheets: 1,    artworks: 22,    width: '22',  lengths: '01 W22/H110.3',                                           product:    90.00, ship:  10.00, total:   100.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260622-31',   dup: false, po_date: '2026-06-22', dispatch: '2026-06-22', customer: 'Tanya Bates',           gangsheets: 1,    artworks: 16,    width: '22',  lengths: '01 W22/H76.5',                                            product:    55.00, ship:  10.00, total:    65.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260624-32',   dup: false, po_date: '2026-06-24', dispatch: '2026-06-24', customer: 'Jacque Monroe',         gangsheets: 3,    artworks: 90,    width: '22',  lengths: '483.4',                                                   product:   200.00, ship:  15.00, total:   215.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260625-33',   dup: false, po_date: '2026-06-25', dispatch: '2026-06-25', customer: 'Angela Tate',           gangsheets: 2,    artworks: 59,    width: '22',  lengths: '193.2',                                                   product:   150.00, ship:  15.00, total:   165.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260626-34',   dup: false, po_date: '2026-06-26', dispatch: '2026-06-26', customer: 'Raqib Ramsarran',       gangsheets: 1,    artworks: 42,    width: '22',  lengths: '79',                                                      product:    53.50, ship:  15.00, total:    68.50, print_type: 'DTF Transfers' },
  { po: 'TSI 260628-35',   dup: false, po_date: '2026-06-28', dispatch: '2026-06-28', customer: 'Jaysin Julios',         gangsheets: 2,    artworks: 57,    width: '22',  lengths: '240',                                                     product:   125.00, ship:  15.00, total:   140.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260704-36',   dup: false, po_date: '2026-07-04', dispatch: '2026-07-04', customer: 'Kyle Morris',           gangsheets: 1,    artworks: 12,    width: '22',  lengths: '75',                                                      product:    50.00, ship:  15.00, total:    65.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260704-37',   dup: false, po_date: '2026-07-04', dispatch: '2026-07-04', customer: 'Angela Tate',           gangsheets: 4,    artworks: 59,    width: '22',  lengths: '377',                                                     product:   175.00, ship:  15.00, total:   190.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260706-38',   dup: false, po_date: '2026-07-07', dispatch: '2026-07-07', customer: 'Jac Jean',              gangsheets: 2,    artworks: 180,   width: '22',  lengths: '122',                                                     product:     0.00, ship:  10.00, total:    10.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260706-39',   dup: false, po_date: '2026-07-07', dispatch: '2026-07-07', customer: 'Gaspar Erosa',          gangsheets: 6,    artworks: 200,   width: '22',  lengths: '546',                                                     product:   245.00, ship:  15.00, total:   260.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260708-40',   dup: false, po_date: '2026-07-08', dispatch: '2026-07-08', customer: 'Jaysin Julios',         gangsheets: 2,    artworks: 200,   width: '22',  lengths: '203',                                                     product:   140.00, ship:  15.00, total:   155.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260709-41',   dup: false, po_date: '2026-07-09', dispatch: '2026-07-09', customer: 'Angela Tate',           gangsheets: 1,    artworks: 8,     width: '22',  lengths: '41',                                                      product:    35.00, ship:  15.00, total:    50.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260709-42',   dup: false, po_date: '2026-07-09', dispatch: '2026-07-09', customer: 'Vicky Campos',          gangsheets: 1,    artworks: 26,    width: '22',  lengths: '51',                                                      product:    58.00, ship:  15.00, total:    73.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260710-43',   dup: false, po_date: '2026-07-10', dispatch: '2026-07-10', customer: 'Carol Johnson Garlin',  gangsheets: 1,    artworks: 60,    width: '22',  lengths: '43',                                                      product:    40.00, ship:  15.00, total:    55.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260710-44',   dup: false, po_date: '2026-07-10', dispatch: '2026-07-10', customer: 'Victor Spates',         gangsheets: 3,    artworks: 40,    width: '22',  lengths: '246',                                                     product:   120.00, ship:  15.00, total:   135.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260710-45',   dup: false, po_date: '2026-07-10', dispatch: '2026-07-10', customer: 'Kyle Morris',           gangsheets: 3,    artworks: 40,    width: '22',  lengths: '246',                                                     product:    40.00, ship:  15.00, total:    55.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260713-46',   dup: false, po_date: '2026-07-13', dispatch: '2026-07-13', customer: 'Araceli Morales',       gangsheets: 1,    artworks: 15,    width: '22',  lengths: '101',                                                     product:    57.00, ship:  15.00, total:    72.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260714-47',   dup: false, po_date: '2026-07-14', dispatch: '2026-07-14', customer: 'Wallace B. Hollins',    gangsheets: 1,    artworks: 3,     width: '22',  lengths: '49',                                                      product:    45.00, ship:  15.00, total:    60.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260714-49',   dup: false, po_date: '2026-07-14', dispatch: '2026-07-14', customer: 'Syd Hackford',          gangsheets: 4,    artworks: 64,    width: '22',  lengths: '374',                                                     product:   181.00, ship:  15.00, total:   196.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260714-50',   dup: false, po_date: '2026-07-14', dispatch: '2026-07-14', customer: 'David Farrar',          gangsheets: 3,    artworks: 34,    width: '22',  lengths: '276',                                                     product:   120.00, ship:  15.00, total:   135.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260715-51',   dup: false, po_date: '2026-07-15', dispatch: '2026-07-15', customer: 'Larry Grippaldi',       gangsheets: 2,    artworks: 42,    width: '22',  lengths: '138',                                                     product:   115.00, ship:  15.00, total:   130.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260716-52',   dup: false, po_date: '2026-07-16', dispatch: '2026-07-16', customer: 'Victor Spates',         gangsheets: 1,    artworks: 8,     width: '22',  lengths: '104',                                                     product:     0.00, ship:  10.00, total:    10.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260720-53',   dup: false, po_date: '2026-07-20', dispatch: '2026-07-20', customer: 'Robert Farrar',         gangsheets: 1,    artworks: 7,     width: '22',  lengths: '108',                                                     product:     0.00, ship:  16.00, total:    16.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260720-54',   dup: false, po_date: '2026-07-20', dispatch: '2026-07-20', customer: 'Victor Spates',         gangsheets: 9,    artworks: 52,    width: '22',  lengths: '109, 106, 99, 99, 99, 99, 99, 99, 11, 44',                product:   332.00, ship:  15.00, total:   347.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260722-55',   dup: false, po_date: '2026-07-22', dispatch: '2026-07-22', customer: 'Alex M. Cabrera',       gangsheets: 1,    artworks: 52,    width: '22',  lengths: '34',                                                      product:    25.00, ship:  10.00, total:    35.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260723-56',   dup: false, po_date: '2026-07-22', dispatch: '2026-07-23', customer: 'Leisha Rogers',         gangsheets: 1,    artworks: 11,    width: '22',  lengths: '69',                                                      product:    28.00, ship:  10.00, total:    38.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260723-57',   dup: false, po_date: '2026-07-23', dispatch: '2026-07-23', customer: 'Robert Farrar',         gangsheets: 2,    artworks: 18,    width: '22',  lengths: '106, 46, 106, 106',                                       product:    57.75, ship:  16.00, total:    73.75, print_type: 'DTF Transfers' },
  { po: 'TSI 260725-58',   dup: false, po_date: '2026-07-25', dispatch: '2026-07-25', customer: 'Keith DuBois',          gangsheets: 1,    artworks: 20,    width: '22',  lengths: '66',                                                      product:    27.00, ship:  15.00, total:    42.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260727-59',   dup: false, po_date: '2026-07-25', dispatch: '2026-07-25', customer: 'Pam Guernsey',          gangsheets: 1,    artworks: 11,    width: '22',  lengths: '80',                                                      product:    50.00, ship:  15.00, total:    65.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260727-60',   dup: false, po_date: '2026-07-25', dispatch: '2026-07-25', customer: 'Kyle Morris',           gangsheets: 1,    artworks: 9,     width: '22',  lengths: '60',                                                      product:    25.00, ship:  15.00, total:    40.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260727-61',   dup: false, po_date: '2026-07-27', dispatch: '2026-07-27', customer: 'Victor Spates',         gangsheets: 2,    artworks: 8,     width: '22',  lengths: '109, 66',                                                 product:    88.00, ship:  15.00, total:   103.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260727-62',   dup: false, po_date: '2026-07-27', dispatch: '2026-07-27', customer: 'Bobbie Lee Hansen',     gangsheets: 1,    artworks: 16,    width: '22',  lengths: '60',                                                      product:    25.00, ship:  11.50, total:    36.50, print_type: 'DTF Transfers' },
  { po: 'TSI 260730-63',   dup: false, po_date: '2026-07-27', dispatch: '2026-07-30', customer: 'Robert Farrar',         gangsheets: 5,    artworks: 65,    width: '22',  lengths: '106, 106, 110, 110, 31, 48',                              product:   534.25, ship:  75.00, total:   609.25, print_type: 'DTF Transfers' },
  { po: 'TSI 260730-64',   dup: false, po_date: '2026-07-27', dispatch: '2026-07-30', customer: 'Robert Farrar',         gangsheets: 5,    artworks: 60,    width: '22',  lengths: '109, 110, 108, 107, 31',                                  product:     0.00, ship:   0.00, total:     0.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260730-65',   dup: false, po_date: '2026-07-31', dispatch: '2026-07-30', customer: 'Robert Farrar',         gangsheets: 10,   artworks: 60,    width: '22',  lengths: '108, 95, 107, 95, 31, 94, 110, 109, 108, 16',             product:     0.00, ship:   0.00, total:     0.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260731-66',   dup: false, po_date: '2026-07-27', dispatch: '2026-07-31', customer: 'Vianelly Chichipa',     gangsheets: 10,   artworks: 74,    width: '22',  lengths: '109',                                                     product:     0.00, ship:  15.00, total:    15.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260731-67',   dup: false, po_date: '2026-07-31', dispatch: '2026-07-31', customer: 'Robert Farrar',         gangsheets: 10,   artworks: 60,    width: '22',  lengths: '108, 99, 105, 108, 96',                                   product:     0.00, ship:   0.00, total:     0.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260801-68',   dup: false, po_date: '2026-07-31', dispatch: '2026-08-01', customer: 'Ricardo Malia',         gangsheets: 2,    artworks: 50,    width: '22',  lengths: '101, 42',                                                 product:    71.00, ship:  10.00, total:    81.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260801-69',   dup: false, po_date: '2026-07-31', dispatch: '2026-08-01', customer: 'Victor Spates',         gangsheets: 1,    artworks: 3,     width: '22',  lengths: '83',                                                      product:    50.00, ship:  15.00, total:    65.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260803-70',   dup: false, po_date: '2026-08-03', dispatch: '2026-08-03', customer: 'Milangella Navarro',    gangsheets: 1,    artworks: 10,    width: '22',  lengths: 'W/22 H:65',                                               product:    37.00, ship:  15.00, total:    52.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260804-71',   dup: false, po_date: '2026-08-04', dispatch: '2026-08-04', customer: 'Jaysin Julios',         gangsheets: 6,    artworks: 127,   width: '22',  lengths: 'W/22 H:105; W/22 H:103; W/22 H:100; W/22 H:105; W/22 H:109; W/22 H:27', product:   260.00, ship:  16.00, total:   276.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260803-72',   dup: false, po_date: '2026-08-03', dispatch: '2026-08-03', customer: 'Angela Tate',           gangsheets: 1,    artworks: 38,    width: '22',  lengths: 'W/22 H:75',                                               product:    35.00, ship:  15.00, total:    50.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260804-73',   dup: false, po_date: '2026-08-04', dispatch: '2026-08-04', customer: 'Robert Farrar',         gangsheets: 6,    artworks: 128,   width: '22',  lengths: 'W/22 H:105; W/22 H:103; W/22 H:100; W/22 H:105; W/22 H:109; W/22 H:27', product:   229.50, ship:  26.00, total:   255.50, print_type: 'DTF Transfers' },
  { po: 'TSI 260804-74',   dup: false, po_date: '2026-08-04', dispatch: '2026-08-04', customer: 'Kyle Morris',           gangsheets: 1,    artworks: 11,    width: '22',  lengths: 'W/22 H:63',                                               product:    32.00, ship:  15.00, total:    47.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260806-75',   dup: false, po_date: '2026-08-06', dispatch: '2026-08-06', customer: 'Bobbie Lee Hansen',     gangsheets: 1,    artworks: 6,     width: '22',  lengths: '58',                                                      product:    40.00, ship:  15.00, total:    55.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260807-76',   dup: false, po_date: '2026-08-07', dispatch: '2026-08-07', customer: 'Richard Dukes',         gangsheets: 1,    artworks: 12,    width: '22',  lengths: '57',                                                      product:    40.00, ship:  15.00, total:    55.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260808-77',   dup: false, po_date: '2026-08-08', dispatch: '2026-08-08', customer: 'Robert Farrar',         gangsheets: null, artworks: null,  width: null,  lengths: null,                                                      product:    95.00, ship:  15.00, total:   110.00, print_type: null },
  { po: 'TSI 260808-78',   dup: false, po_date: '2026-08-08', dispatch: '2026-08-08', customer: 'Samuel Ngwamukie',      gangsheets: 3,    artworks: 28,    width: '22',  lengths: '109, 92, 31',                                             product:    68.00, ship:  18.00, total:    86.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260810-79',   dup: false, po_date: '2026-08-10', dispatch: '2026-08-10', customer: 'Anglea Tate',           gangsheets: 1,    artworks: 38,    width: '22',  lengths: '57',                                                      product:    50.00, ship:  15.00, total:    65.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260810-80',   dup: false, po_date: '2026-08-10', dispatch: '2026-08-10', customer: 'Carol Johnson Garlin',  gangsheets: 2,    artworks: 40,    width: '22',  lengths: '106, 87',                                                 product:    95.00, ship:  10.00, total:   105.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260811-81',   dup: false, po_date: '2026-08-11', dispatch: '2026-08-11', customer: 'Robert Farrar',         gangsheets: 7,    artworks: 101,   width: '22',  lengths: '94, 93, 93, 108, 108, 108, 108, 76',                      product:   303.00, ship:  26.00, total:   329.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260812-82',   dup: false, po_date: '2026-08-12', dispatch: '2026-08-12', customer: 'Maurice Boykins',       gangsheets: 1,    artworks: 22,    width: '22',  lengths: '105',                                                     product:    65.00, ship:  15.00, total:    80.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260814-83',   dup: false, po_date: '2026-08-14', dispatch: '2026-08-14', customer: 'Ricardo Malia',         gangsheets: 2,    artworks: 50,    width: '22',  lengths: '104, 43',                                                 product:    64.00, ship:  15.00, total:    79.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260814-84',   dup: false, po_date: '2026-08-14', dispatch: '2026-08-14', customer: 'Kyle Morris',           gangsheets: 1,    artworks: 12,    width: '22',  lengths: '84',                                                      product:    40.00, ship:  15.00, total:    55.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260814-85',   dup: false, po_date: '2026-08-14', dispatch: '2026-08-14', customer: 'Marc Dagupion',         gangsheets: 1,    artworks: 80,    width: '22',  lengths: '77',                                                      product:     0.00, ship:  10.00, total:    10.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260814-86',   dup: false, po_date: '2026-08-14', dispatch: '2026-08-14', customer: 'Robert Farrar',         gangsheets: 4,    artworks: 42,    width: '22',  lengths: '77, 77, 77, 77',                                          product:   109.00, ship:  26.00, total:   135.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260815-87',   dup: false, po_date: '2026-08-15', dispatch: '2026-08-15', customer: 'Johney Gates',          gangsheets: 1,    artworks: 10,    width: '22',  lengths: '48',                                                      product:    37.00, ship:  15.00, total:    52.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260815-88',   dup: false, po_date: '2026-08-15', dispatch: '2026-08-15', customer: 'Robert Farrar',         gangsheets: 7,    artworks: 82,    width: '22',  lengths: '15, 108, 93, 107, 93, 107, 107, 105, 107, 15, 15',        product:     0.00, ship:   0.00, total:     0.00, print_type: 'DTF Transfers' },
  { po: 'TSI 260818-89',   dup: false, po_date: '2026-08-18', dispatch: '2026-08-18', customer: 'ROBERT FARRAR',         gangsheets: 3,    artworks: 8,     width: '22',  lengths: '108, 99, 55',                                             product:    99.00, ship:  26.00, total:   125.00, print_type: 'DTF Transfers' },
]

// The rows that need a chain or a purchase order built. Status is stated here
// rather than guessed: each mirrors the purchase order already on file for that
// job, or — for the rows billed together — the PO their money was billed with.
const CREATE_PLAN = {
  'TSI 260604-21b': { orderStatus: 'Delivered',     poStatus: 'Closed',
                      why: 'free re-run of TSI 260604-21; shipping only' },
  'TSI 260720-53':  { orderStatus: 'Delivered',     poStatus: 'Closed',
                      why: 'product free, shipping only; PO-2026-0060 already on file' },
  'TSI 260730-64':  { orderStatus: 'Delivered',     poStatus: 'Closed',
                      why: 'billed together with TSI 260730-63' },
  'TSI 260730-65':  { orderStatus: 'Delivered',     poStatus: 'Closed',
                      why: 'billed together with TSI 260730-63' },
  'TSI 260731-67':  { orderStatus: 'Delivered',     poStatus: 'Closed',
                      why: 'billed together with TSI 260730-63' },
  'TSI 260808-77':  { orderStatus: 'Delivered',     poStatus: 'Closed',
                      why: 'PO-2026-0086 already on file; sheet lists no print detail' },
  'TSI 260815-88':  { orderStatus: 'In Production', poStatus: 'In Production',
                      why: 'PO-2026-0096 already on file; sheet lists no amount' },
  'TSI 260818-89':  { orderStatus: 'In Production', poStatus: 'In Production',
                      why: 'newest row on the sheet' },
}

// A sheet row's stable identity. The duplicate 21 shares a source_po_number
// with the original, so it is separated by entry key, not by number.
const entryKey = r => `${SOURCE_SYSTEM}:${r.po}`
const srcPo    = r => (r.dup ? r.po.replace(/b$/, '') : r.po)
const money    = n => Number(n).toFixed(2)

const stats = {
  orderMoney: 0, invoiceMoney: 0, poMoney: 0, notesCleared: 0, printType: 0,
  posCreated: 0, chainsCreated: 0, relinked: 0, ordersDeleted: 0, posDeleted: 0, trackingFilled: 0,
  tshirtRetyped: 0,
}
const report = []
const note = (kind, line) => { report.push(`  [${kind}] ${line}`) }

async function nextNumber(client, table, column, prefix, width) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(SUBSTRING(${column} FROM '[0-9]+$')::int), 0) AS n
       FROM ${table} WHERE ${column} LIKE $1`, [`${prefix}%`])
  let n = rows[0].n
  return () => `${prefix}${String(++n).padStart(width, '0')}`
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: [actor] } = await client.query(
      `SELECT id FROM users WHERE email = 'info@technocas.com' LIMIT 1`)
    if (!actor) throw new Error('No acting user found')
    const { rows: [supplier] } = await client.query(
      `SELECT id FROM suppliers WHERE name = $1 LIMIT 1`, [VENDOR_NAME])
    if (!supplier) throw new Error(`Supplier ${VENDOR_NAME} not found`)

    const custIds = {}
    for (const num of new Set(Object.values(CUSTOMER_BY_SHEET_NAME))) {
      const { rows } = await client.query(
        `SELECT id FROM customers WHERE customer_number = $1`, [num])
      if (!rows[0]) throw new Error(`Customer ${num} not found`)
      custIds[num] = rows[0].id
    }

    const qNext = await nextNumber(client, 'quotations',      'quote_number',   'Q-2026-',    4)
    const oNext = await nextNumber(client, 'orders',          'order_number',   'ORD-2026-',  4)
    const iNext = await nextNumber(client, 'invoices',        'invoice_number', 'INV-2026-',  4)
    const pNext = await nextNumber(client, 'purchase_orders', 'po_number',      'PO-2026-',   4)
    const yNext = await nextNumber(client, 'payments',        'payment_number', 'PAY-2026-',  4)

    // ── Step 1 — the records that are not in the sheet ───────────────────────
    for (const num of ORPHAN_ORDERS) {
      const { rowCount } = await client.query(
        `UPDATE orders SET deleted_at = NOW(), updated_at = NOW()
          WHERE order_number = $1 AND deleted_at IS NULL`, [num])
      if (rowCount) { stats.ordersDeleted++; note('DELETE', `${num} — no TSI reference, matches no sheet row`) }
    }
    for (const num of ORPHAN_POS) {
      const { rowCount } = await client.query(
        `UPDATE purchase_orders SET deleted_at = NOW(), updated_at = NOW()
          WHERE po_number = $1 AND deleted_at IS NULL`, [num])
      if (rowCount) { stats.posDeleted++; note('DELETE', `${num} — parity backfill for a deleted order`) }
    }

    // ── Step 2 — custom t-shirt POs are apparel, not gangsheet ───────────────
    const { rowCount: retyped } = await client.query(
      `UPDATE purchase_orders SET po_type = 'apparel', updated_at = NOW()
        WHERE po_number = ANY($1) AND po_type <> 'apparel' AND deleted_at IS NULL`, [TSHIRT_POS])
    stats.tshirtRetyped = retyped
    if (retyped) note('RETYPE', `${retyped} TS-PA-* purchase orders: gangsheet → apparel`)

    // ── Step 3 — the hand-keyed TSI 260808-78 ────────────────────────────────
    const { rows: [hk] } = await client.query(
      `SELECT id, invoice_id FROM orders WHERE order_number = $1 AND deleted_at IS NULL`, [HANDKEYED.order])
    const { rows: [hkPo] } = await client.query(
      `SELECT id FROM purchase_orders WHERE po_number = $1 AND deleted_at IS NULL`, [HANDKEYED.po])
    if (hk && hkPo) {
      await client.query(
        `UPDATE orders SET source_system = $1, source_po_number = $2, source_entry_key = $3, updated_at = NOW()
          WHERE id = $4`, [SOURCE_SYSTEM, HANDKEYED.sheet, `${SOURCE_SYSTEM}:${HANDKEYED.sheet}`, hk.id])
      await client.query(
        `UPDATE purchase_orders SET order_id = COALESCE(order_id, $1), updated_at = NOW() WHERE id = $2`,
        [hk.id, hkPo.id])
      await client.query(
        `INSERT INTO po_orders (po_id, order_id, sort_order) VALUES ($1,$2,0)
         ON CONFLICT (po_id, order_id) DO NOTHING`, [hkPo.id, hk.id])
      stats.relinked++
      note('RELINK', `${HANDKEYED.order} ↔ ${HANDKEYED.po} as ${HANDKEYED.sheet}`)
    }

    // ── Step 4 — walk the sheet ──────────────────────────────────────────────
    for (const r of SHEET) {
      const key = entryKey(r)
      const src = srcPo(r)

      // Locate this row's order. The duplicate 21 is matched on entry key only,
      // so it can never bind to the original's chain.
      const { rows: orders } = r.dup
        ? await client.query(
            `SELECT id, invoice_id, subtotal, shipping_charges, total FROM orders
              WHERE source_entry_key = $1 AND deleted_at IS NULL`, [key])
        : await client.query(
            `SELECT id, invoice_id, subtotal, shipping_charges, total FROM orders
              WHERE source_po_number = $1 AND deleted_at IS NULL
                AND (source_entry_key IS NULL OR source_entry_key NOT LIKE '%:%b')
              ORDER BY created_at LIMIT 1`, [src])
      const { rows: pos } = r.dup
        ? await client.query(
            `SELECT id, subtotal, freight_charges, grand_total FROM purchase_orders
              WHERE source_entry_key = $1 AND deleted_at IS NULL`, [key])
        : await client.query(
            `SELECT id, subtotal, freight_charges, grand_total FROM purchase_orders
              WHERE source_po_number = $1 AND deleted_at IS NULL
                AND (source_entry_key IS NULL OR source_entry_key NOT LIKE '%:%b')
              ORDER BY created_at LIMIT 1`, [src])

      const order = orders[0]
      const po    = pos[0]

      // 4a — money on an existing order + its invoice.
      if (order) {
        const needs = Number(order.subtotal) !== r.product
          || Number(order.shipping_charges) !== r.ship
          || Number(order.total) !== r.total
        if (needs) {
          await client.query(
            `UPDATE orders SET subtotal = $1, shipping_charges = $2, total = $3, updated_at = NOW()
              WHERE id = $4`, [r.product, r.ship, r.total, order.id])
          stats.orderMoney++
          note('MONEY', `${r.po} order  ${money(order.subtotal)}/${money(order.shipping_charges)}/${money(order.total)}` +
                        ` → ${money(r.product)}/${money(r.ship)}/${money(r.total)}`)
        }
        if (order.invoice_id) {
          const { rowCount } = await client.query(
            `UPDATE invoices SET subtotal = $1, shipping_charges = $2, total = $3, updated_at = NOW()
              WHERE id = $4 AND (subtotal <> $1 OR shipping_charges <> $2 OR total <> $3)`,
            [r.product, r.ship, r.total, order.invoice_id])
          if (rowCount) stats.invoiceMoney++
        }
        // 4b — notes cleared, print type stamped.
        const { rowCount: cleared } = await client.query(
          `UPDATE orders SET notes = NULL, updated_at = NOW()
            WHERE id = $1 AND notes IS NOT NULL AND BTRIM(notes) <> ''`, [order.id])
        if (cleared) stats.notesCleared++
        const { rowCount: typed } = await client.query(
          `UPDATE orders SET print_type = $1, updated_at = NOW()
            WHERE id = $2 AND print_type IS DISTINCT FROM $1`, [r.print_type, order.id])
        if (typed) stats.printType++
      }

      // 4c — money on an existing PO.
      if (po) {
        const needs = Number(po.subtotal) !== r.product
          || Number(po.freight_charges) !== r.ship
          || Number(po.grand_total) !== r.total
        if (needs) {
          await client.query(
            `UPDATE purchase_orders
                SET subtotal = $1, net_product_amount = $1, freight_charges = $2, shipping_charge = $2,
                    total = $3, grand_total = $3, updated_at = NOW()
              WHERE id = $4`, [r.product, r.ship, r.total, po.id])
          stats.poMoney++
          note('MONEY', `${r.po} PO     ${money(po.subtotal)}/${money(po.freight_charges)}/${money(po.grand_total)}` +
                        ` → ${money(r.product)}/${money(r.ship)}/${money(r.total)}`)
        }
      }

      // 4d — build what is missing. Status is stated per row rather than
      // guessed: it mirrors the purchase order for this job, or the sibling PO
      // the job was billed with. Payment only where there is money.
      const plan = CREATE_PLAN[r.po]
      let orderId = order?.id || null

      if (!order) {
        if (!plan) throw new Error(`${r.po} has no sales order and no build plan`)
        const custNum = CUSTOMER_BY_SHEET_NAME[r.customer]
        if (!custNum) throw new Error(`${r.po}: no customer mapping for "${r.customer}"`)
        const custId = custIds[custNum]
        const a = ADDRESSES[custNum]
        const address = `${a.line1}, ${a.city}, ${a.state} ${a.zip}, United States`
        const paid = r.total > 0

        // As with invoices below: an earlier importer may already have left a
        // quotation for this row with no sales order attached. Reuse it rather
        // than raising a second one.
        const { rows: [existingQuote] } = await client.query(
          `SELECT id, quote_number FROM quotations q
            WHERE q.source_po_number = $1 AND q.deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.quotation_id = q.id AND o.deleted_at IS NULL)
            ORDER BY q.created_at LIMIT 1`, [srcPo(r)])
        if (existingQuote) note('REUSE', `${r.po} → existing ${existingQuote.quote_number} attached rather than raising a second quotation`)

        const { rows: [quote] } = existingQuote ? { rows: [existingQuote] } : await client.query(
          `INSERT INTO quotations (quote_number, status, customer_name, customer_id,
             billing_address, shipping_address, shipping_city, shipping_state, zip_code, shipping_country,
             subtotal, total, estimated_shipping, shipping_amount, quote_estimate, currency, order_type,
             payment_terms, payment_method, due_date, valid_until, approved_at, entry_date, sent_at,
             tax_amt, tax_pct, discount_amt, discount_pct, discount_value, discount_type, rush_services,
             revision_number, notes, customer_notes, created_by, sales_agent_id,
             source_system, source_po_number, source_entry_key)
           VALUES ($1,'Approved',$2,$3,$4,$4,$5,$6,$7,'United States',
                   $8,$9,$10,$10,$9,'USD','dtf','Advance','Historical Import',
                   $11::date,($11::date + 7),$11::date::timestamptz,$12::date,$11::date::timestamptz,
                   0,0,0,0,0,'fixed',0,1,NULL,NULL,$13,$13,$14,$15,$16)
           RETURNING id`,
          [qNext(), r.customer, custId, address, a.city, a.state, a.zip,
           r.product, r.total, r.ship, r.dispatch, ENTRY_DATE, actor.id, SOURCE_SYSTEM, srcPo(r), key])

        const { rows: [newOrder] } = await client.query(
          `INSERT INTO orders (order_number, quotation_id, status, order_type, order_date, entry_date, due_date,
             subtotal, total, shipping_charges, currency, payment_terms, payment_method, payment_status,
             amount_paid, tax_amt, tax_pct, discount_amt, discount_pct, rush_services,
             customer_id, contact_name, shipping_name, shipping_address, shipping_method,
             notes, print_type, created_by, gangsheet_status, production_priority, total_print_locations,
             source_system, source_po_number, source_entry_key)
           VALUES ($1,$2,$3::order_status,'dtf',$4::date,$5::date,$4::date,
                   $6,$7,$8,'USD','Advance','Historical Import',$9::payment_status,
                   $10,0,0,0,0,0,$11,$12,$12,$13,'Decoinks Fulfillment',
                   NULL,$14,$15,'none','Standard',0,$16,$17,$18)
           RETURNING id`,
          [oNext(), quote.id, plan.orderStatus, r.dispatch, ENTRY_DATE,
           r.product, r.total, r.ship, paid ? 'Paid' : 'Unpaid', paid ? r.total : 0,
           custId, r.customer, address, r.print_type, actor.id, SOURCE_SYSTEM, srcPo(r), key])
        orderId = newOrder.id

        await client.query(
          `INSERT INTO order_items_dtf (order_id, artwork_name, size, qty, unit_price, amount, sort_order, production_status)
           VALUES ($1,'AGGREGATE - DTF Transfers (aggregate)',$2,$3,$4,$5,0,'Artwork Approved')`,
          [orderId,
           r.gangsheets ? `${r.width}" × ${r.gangsheets} sheet${r.gangsheets > 1 ? 's' : ''}` : null,
           r.artworks || 0,
           r.artworks ? +(r.product / r.artworks).toFixed(2) : 0,
           r.product])

        // An earlier importer may already have left an invoice for this row with
        // no sales order attached. Reuse it rather than raising a second one —
        // skipping this check on 2026-08-21 produced duplicate invoices for
        // TSI 260720-53 and TSI 260808-77, and a duplicate payment for the latter
        // (repaired by repair-duplicate-invoices-2026-08-21.js).
        const { rows: [existingInv] } = await client.query(
          `SELECT id, invoice_number FROM invoices
            WHERE source_po_number = $1 AND deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = invoices.order_id AND o.deleted_at IS NULL)
            ORDER BY created_at LIMIT 1`, [srcPo(r)])
        if (existingInv) {
          await client.query(
            `UPDATE invoices SET order_id = $1, subtotal = $2, shipping_charges = $3,
                    original_shipping_charges = $3, total = $4, updated_at = NOW()
              WHERE id = $5`, [orderId, r.product, r.ship, r.total, existingInv.id])
          await client.query(`UPDATE orders SET invoice_id = $1 WHERE id = $2`, [existingInv.id, orderId])
          await client.query(
            `UPDATE payments SET order_id = $1 WHERE invoice_id = $2 AND order_id IS NULL`,
            [orderId, existingInv.id])
          note('REUSE', `${r.po} → existing ${existingInv.invoice_number} attached rather than raising a second invoice`)
        }

        const invNo = existingInv ? null : iNext()
        const { rows: [invoice] } = existingInv ? { rows: [existingInv] } : await client.query(
          `INSERT INTO invoices (invoice_number, internal_no, quote_id, order_id, status, order_type,
             issue_date, due_date, subtotal, total, shipping_charges, original_shipping_charges,
             currency, payment_terms, payment_method, amount_paid, balance_due, paid_at,
             tax_amt, tax_pct, discount_amt, discount_pct, discount_value, discount_type, rush_charges, rush_services,
             customer_id, customer_name, billing_address, shipping_address, notes, created_by,
             source_system, source_po_number, source_entry_key)
           VALUES ($1,$2,$3,$4,$5::invoice_status,'dtf',
                   $6::date,$6::date,$7,$8,$9,$9,'USD','Advance','Historical Import',
                   $10,$11,$12,
                   0,0,0,0,0,'percentage',0,0,$13,$14,$15,$15,NULL,$16,$17,$18,$19)
           RETURNING id`,
          [invNo, `INV-INT-${invNo.replace('INV-', '')}`, quote.id, orderId,
           paid ? 'Paid' : 'Draft', r.dispatch, r.product, r.total, r.ship,
           paid ? r.total : 0, paid ? 0 : r.total, paid ? `${r.dispatch}T00:00:00Z` : null,
           custId, r.customer, address, actor.id, SOURCE_SYSTEM, srcPo(r), key])
        await client.query(`UPDATE orders SET invoice_id = $1 WHERE id = $2`, [invoice.id, orderId])

        // Only raise a payment for an invoice this run created. A reused invoice
        // already carries whatever the earlier import recorded against it, and
        // adding another here is exactly how the duplicate $110 was produced.
        if (paid && !existingInv) {
          await client.query(
            `INSERT INTO payments (payment_number, payment_date, paid_at, amount, payment_method,
               status, customer_id, order_id, invoice_id, customer_name, notes, recorded_by)
             VALUES ($1,$2::date,$2::date::timestamptz,$3,'Historical Import','Completed',$4,$5,$6,$7,$8,$9)`,
            [yNext(), r.dispatch, r.total, custId, orderId, invoice.id, r.customer,
             `Advance payment recorded with the ${r.po} reconciliation`, actor.id])
        }

        stats.chainsCreated++
        note('CREATE', `${r.po} → sales order for ${r.customer}, ` +
                       `${money(r.product)} + ${money(r.ship)} shipping = ${money(r.total)}` +
                       (plan.why ? ` (${plan.why})` : ''))
      }

      // 4e — build the purchase order if this row never got one.
      if (!po) {
        if (!plan) throw new Error(`${r.po} has no purchase order and no build plan`)
        const custNum = CUSTOMER_BY_SHEET_NAME[r.customer]
        const custId  = custIds[custNum]
        const a = ADDRESSES[custNum]
        const address = `${a.line1}, ${a.city}, ${a.state} ${a.zip}, United States`
        await client.query(
          `INSERT INTO purchase_orders (po_number, supplier_reference, order_id, customer_id, status, po_type,
             order_date, entry_date, expected_date, required_dispatch_text,
             subtotal, total, grand_total, net_product_amount, shipping_charge, freight_charges,
             total_tax, total_discount, other_charges, currency, exchange_rate,
             payment_terms, payment_status, payment_received,
             supplier_id, vendor_name, brand, language, priority, production_priority,
             print_type, gangsheet_width, gangsheet_lengths, total_gangsheets, total_artworks, packages,
             shipping_method, shipping_address, communication_method,
             notes, created_by, imported_at, source_system, source_po_number, source_entry_key)
           VALUES ($1,$2,$3,$4,$5::po_status,'gangsheet',
                   $6::date,$7::date,$8::date,$8,
                   $9,$10,$10,$9,$11,$11,0,0,0,'USD',1.0000,
                   'Advance',$12,$13,
                   $14,$15,'Decoinks LLC','en','Medium','Standard',
                   $16,$17,$18,$19,$20,1,
                   'Decoinks Fulfillment',$21,'email',
                   NULL,$22,NOW(),$23,$24,$25)`,
          [pNext(), r.po, orderId, custId, plan.poStatus,
           r.po_date, ENTRY_DATE, r.dispatch,
           r.product, r.total, r.ship,
           r.total > 0 ? 'Paid' : 'Unpaid', r.total > 0 ? r.total : 0,
           supplier.id, VENDOR_NAME,
           r.print_type, r.width, r.lengths, r.gangsheets, r.artworks,
           address, actor.id, SOURCE_SYSTEM, srcPo(r), key])
        const { rows: [madePo] } = await client.query(
          `SELECT id FROM purchase_orders WHERE source_entry_key = $1 ORDER BY created_at DESC LIMIT 1`, [key])
        if (madePo && orderId) {
          await client.query(
            `INSERT INTO po_orders (po_id, order_id, sort_order) VALUES ($1,$2,0)
             ON CONFLICT (po_id, order_id) DO NOTHING`, [madePo.id, orderId])
        }
        stats.posCreated++
        note('CREATE', `${r.po} → purchase order, ${money(r.product)} + ${money(r.ship)} freight`)
      } else if (orderId) {
        // The purchase order was already on file but its sales order was not, so
        // the two were never tied together. Only rows with no link at all are
        // touched — a PO already carrying order_id is left exactly as it is.
        const { rowCount: tied } = await client.query(
          `UPDATE purchase_orders SET order_id = $1, updated_at = NOW()
            WHERE id = $2 AND order_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM po_orders WHERE po_id = $2 AND order_id = $1)`,
          [orderId, po.id])
        if (tied) { stats.relinked++; note('LINK', `${r.po} → purchase order tied to its new sales order`) }
      }
    }

    // ── Step 5 — carry tracking the system already holds onto the order ──────
    // The sheet has no tracking column, so nothing is invented here: this only
    // copies a number already recorded on the row's own purchase order onto the
    // sales order, which is where the order screen and the export read it from.
    const { rows: trackFills } = await client.query(
      `UPDATE orders o
          SET tracking_number = p.tracking_number,
              courier = COALESCE(NULLIF(BTRIM(o.courier), ''), p.carrier,
                                 CASE WHEN p.tracking_number LIKE '1Z%' THEN 'UPS' END),
              updated_at = NOW()
         FROM purchase_orders p
        WHERE o.order_type = 'dtf' AND o.deleted_at IS NULL
          AND COALESCE(BTRIM(o.tracking_number), '') = ''
          AND p.deleted_at IS NULL
          AND COALESCE(BTRIM(p.tracking_number), '') <> ''
          AND (p.order_id = o.id
               OR EXISTS (SELECT 1 FROM po_orders x WHERE x.order_id = o.id AND x.po_id = p.id))
        RETURNING o.order_number, o.source_po_number, p.tracking_number`)
    for (const t of trackFills) {
      note('TRACKING', `${t.source_po_number} → ${t.order_number} takes ${t.tracking_number} from its purchase order`)
    }
    stats.trackingFilled = trackFills.length

    // ── Step 6 — verify before deciding whether to keep the transaction ──────
    const { rows: [check] } = await client.query(
      `SELECT COUNT(*)::int AS dtf_orders,
              COUNT(*) FILTER (WHERE subtotal + shipping_charges <> total)::int AS money_wrong,
              COUNT(*) FILTER (WHERE BTRIM(COALESCE(notes,'')) <> '')::int AS with_notes,
              COUNT(*) FILTER (WHERE print_type IS NULL)::int AS no_print_type
         FROM orders WHERE order_type = 'dtf' AND deleted_at IS NULL`)
    const { rows: [poCheck] } = await client.query(
      `SELECT COUNT(*)::int AS dtf_pos FROM purchase_orders
        WHERE po_type = 'gangsheet' AND deleted_at IS NULL`)

    console.log('\n' + (APPLY ? 'APPLIED' : 'DRY RUN — nothing written') + '\n')
    console.log(report.join('\n') || '  (no changes needed)')
    console.log('\nSummary')
    for (const [k, v] of Object.entries(stats)) if (v) console.log(`  ${k.padEnd(16)} ${v}`)
    console.log('\nResulting state')
    console.log(`  DTF sales orders            ${check.dtf_orders}   (expected 88)`)
    console.log(`  ...where sub+ship <> total  ${check.money_wrong}   (expected 0)`)
    console.log(`  ...still carrying notes     ${check.with_notes}   (expected 0)`)
    console.log(`  ...without a print type     ${check.no_print_type}   (expected 1 — TSI 260808-77)`)
    console.log(`  DTF purchase orders         ${poCheck.dtf_pos}   (expected 88)`)

    if (APPLY) {
      await client.query('COMMIT')
      console.log('\nCommitted.')
    } else {
      await client.query('ROLLBACK')
      console.log('\nRolled back. Re-run with --apply to keep these changes.')
    }
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nRolled back:', err.message)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
