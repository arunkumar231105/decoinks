# Smart CSV Import — one file, every module

You can keep **one master CSV** with every column you care about
(customer info + line items + order/quote/invoice fields) and upload the
**same file** in any module. Each importer reads only the columns it
understands and silently ignores the rest.

- Upload it under **Quotes → Bulk Upload** → only quote-relevant columns
  are used (customer details, product/qty/price, sizes/colors, notes,
  due date, estimate, status).
- Upload it under **Orders → Bulk Upload** → only order-relevant columns
  are used (order_type, contact, product/qty/price, size/color,
  no_artworks/price_per_sheet, payment terms, shipping).

Headers are matched **case-insensitively** and ignore spaces, dashes and
underscores, so `Customer Name`, `customer_name` and `CUSTOMERNAME` are
all the same column. Many synonyms are accepted (e.g. `email` /
`billing_email`, `qty` / `quantity`, `price` / `unit_price` / `rate`,
`size` / `sizes`, `no_artworks` / `artworks`).

## Master template

See `master-import-template.csv` in this folder. Columns:

| Column | Used by Quote | Used by Order |
|---|---|---|
| customer_name | ✅ customer name | ✅ contact name |
| company | ✅ | – (ignored) |
| email | ✅ billing email | ✅ contact email |
| phone | ✅ | ✅ |
| whatsapp, wechat | ✅ | – |
| category, source | ✅ | – |
| country, state, city, zip | ✅ | – |
| shipping_address | ✅ | ✅ |
| billing_address | ✅ | – |
| order_type (apparel/gangsheet/dtf) | – (ignored) | ✅ required for items |
| product / item | ✅ line description | ✅ line item |
| qty | ✅ | ✅ |
| unit_price / price | ✅ | ✅ |
| size, color | ✅ | ✅ |
| no_artworks | ✅ | ✅ (gangsheet) |
| price_per_sheet | – | ✅ (gangsheet) |
| payment_terms | – | ✅ |
| due_date | ✅ | ✅ |
| notes | ✅ internal notes | ✅ notes |
| estimate | ✅ | – |
| status | ✅ | – |

**Note:** each CSV **row** becomes one quote (or one order) with a single
line item. Unknown columns never cause an error — they are just skipped.
Both importers support a dry-run preview before committing.
