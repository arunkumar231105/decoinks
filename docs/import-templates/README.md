# Import Templates — Customers & Quotations

Ye templates **actual importer code** se derive kiye gaye hain (guesswork nahi).
Column names bilkul wahi hain jo software parse karta hai — is liye data
misplace nahi hoga.

| File | Kis ke liye | Kahan upload karein |
|---|---|---|
| `customers-import-template.csv` | Customers | **Customers** page → **Import Customers** button |
| `quotation-custom-apparel-template.csv` | Custom Printed Apparel quotes | **Quotes** page → **Bulk Upload** |
| `quotation-dtf-transfers-template.csv` | DTF Transfers quotes | **Quotes** page → **Bulk Upload** |
| `quotation-gangsheet-template.csv` | Gangsheet quotes | **Quotes** page → **Bulk Upload** |

---

## Sabse important 5 rules (ye padh lein warna data kharab hoga)

1. **1 CSV row = 1 quotation, aur us mein sirf 1 line item.**
   Agar ek quote mein 5 products hain, to CSV import 5 **alag-alag quotes**
   banayega — ek hi quote mein 5 rows nahi aayenge. Multi-line quotes ke liye
   UI form use karein.

2. **Header ka naam mat badlein.** Importer sirf specific naam pehchanta hai.
   Capital/small aur space/underscore se farq nahi padta (`Customer Name` =
   `customer_name`), lekin **naya lafz** likha to woh column **chup-chaap ignore**
   ho jayega — koi error nahi aayega, data bas gayab ho jayega.

3. **`status` bilkul exact likhein:** `Draft`, `Sent`, `Approved`, `Rejected`,
   `Expired`. Chhota-bara farq padta hai (`draft` galat hai). Galat value par
   **poori row skip** ho jaati hai.

4. **`qty` mein comma na dalein.** `1000` sahi hai, `1,000` se row skip ho jayegi.
   (`unit_price` mein `$` aur comma chal jaata hai, lekin behtar hai saaf rakhein.)

5. **Date format:** `YYYY-MM-DD` (jaise `2026-08-15`). Galat date par row skip.

---

## Import se pehle preview zaroor karein

Quotes ka Bulk Upload pehle **preview (dry run)** dikhata hai:
- `headersDetected` — aapki file ke saare columns
- `recognisedColumns` — jo importer ne samjhe

Agar koi column `recognisedColumns` mein **nahi** hai, matlab woh data import
**nahi** hoga. Commit karne se pehle yahin pakad lein.

---

## 1. Customers template

**Columns aur matlab:**

| Column | Zaroori? | Matlab / Allowed values |
|---|---|---|
| `name` | **Haan** | Customer ka display name. Khali hua to row fail. (Agar `name` na ho to `first_name + last_name`, ya `company_name` se bana lega.) |
| `first_name` | Nahi | Pehla naam |
| `last_name` | Nahi | Aakhri naam |
| `company_name` | Nahi | Company ka naam |
| `email` | Nahi | Email. **Duplicate email allowed nahi** — dobara wahi email hoga to row fail hogi |
| `phone` | Nahi | Company phone. (System ise `phone` aur `company_phone_number` dono mein likhta hai) |
| `mobile_number` | Nahi | Mobile number |
| `whatsapp` | Nahi | WhatsApp number |
| `customer_segment` | Nahi | Free text — jaise `retail`, `wholesale`, `corporate` |
| `customer_type` | Nahi | **Sirf** `business`, `individual`, ya `non_profit`. Kuch aur likha to khali reh jayega |
| `city` | Nahi | Sheher |
| `state` | Nahi | State |
| `zip` | Nahi | ZIP code. ⚠️ Header **`zip`** hi likhein — `zip_code` kaam **nahi** karta |
| `country` | Nahi | Mulk. Khali chhoda to `United States` ho jayega |
| `notes` | Nahi | Internal notes |

**Jo columns customer import se set NAHI ho sakte** (baad mein UI se bharne
padenge): address line 1/2, billing address, preferred language, loyalty tier,
job title, payment terms, credit limit, website, assigned agent.
Is liye Shipping/Billing address **customer import se nahi aayenge** — woh
customer profile mein manually ya quote ke through aate hain.

---

## 2, 3, 4. Quotation templates (teeno types)

Teeno files ka **customer block same** hai; sirf item wale columns type ke
hisaab se badalte hain.

### Common columns (teeno mein)

| Column | Matlab |
|---|---|
| `order_type` | Quote ka type — **yeh decide karta hai kaunsa form khulega** (neeche dekhein) |
| `customer_name` | Customer ka naam |
| `company_name` | Company |
| `email` | Billing email |
| `phone` | Contact number |
| `whatsapp` / `wechat` | Messaging contacts |
| `customer_category` | Buyer type — jaise `Retail`, `Wholesale`, `Corporate` |
| `customer_source` | Lead source — jaise `Email`, `WhatsApp`, `Referral`, `Walk-in` |
| `country`, `state`, `city`, `zip` | Shipping location |
| `shipping_address` | Poora shipping address (comma ho to `"..."` mein likhein) |
| `billing_address` | Billing address |
| `due_date` | Delivery/due date — `YYYY-MM-DD` |
| `status` | `Draft` / `Sent` / `Approved` / `Rejected` / `Expired` |
| `quote_estimate` | Estimated value (number) |
| `internal_notes` | Team ke liye notes |

### `order_type` ki values

Importer free text ko samajh leta hai:

| Aap likhein | Result |
|---|---|
| `apparel` (ya koi bhi aur lafz) | Custom Printed Apparel |
| `dtf` **ya** `DTF Transfer` (jis mein `dtf` ya `transfer` ho) | DTF Transfers |
| `gangsheet` / `Gang Sheet` (jis mein `gang` ho) | Gangsheet |
| khali | koi type nahi (NULL) — **isse bachein** |

### Item columns — type ke hisaab se

**Custom Apparel** (`quotation-custom-apparel-template.csv`):

| Column | Matlab |
|---|---|
| `product` | Style ka naam — jaise `180G Adult 100% Cotton T-Shirt` |
| `sizes` | Size — `XL`, ya multiple `S,M,L` |
| `colors` | Color — jaise `Black` |
| `qty` | Quantity (pieces) |
| `unit_price` | Per piece rate |
| `artwork_count` | Kitni artworks (front=1, front+back=2) |

**DTF Transfers** (`quotation-dtf-transfers-template.csv`):

| Column | Matlab |
|---|---|
| `product` | Transfer ka size — jaise `12" x 14"` (CSV mein `"12"" x 14"""` likha jaata hai) |
| `qty` | Kitne transfers (pieces) |
| `unit_price` | Per transfer rate |
| `artwork_count` | Aam tor par `1` |

**Gangsheet** (`quotation-gangsheet-template.csv`):

| Column | Matlab |
|---|---|
| `product` | Sheet ka size — jaise `22" x 60"` |
| `qty` | Kitni sheets |
| `unit_price` | Per sheet rate |
| `artwork_count` | Sheet par kitni artworks hain |

---

## Zaroori limitations (jo abhi CSV se import NAHI hote)

Ye cheezein import ke baad **UI se bharni padengi**:

- **DTF `artwork_no`** (AW-000 wala number) — CSV column maujood nahi
- **Apparel ka product `category`** (T-Shirt/Hoodie) aur `brand` — line item par
  import nahi hota. ⚠️ **Trap:** `category` naam ka column **customer category**
  (buyer type) mein chala jayega, product category mein **nahi**. Is liye
  templates mein maine jaan-boojh kar `customer_category` naam rakha hai
- **Artwork images / files** — CSV se attach nahi hote
- **Discount aur Tax** — import par hamesha `0` set hote hain
- **Customer linkage** — imported quote customer ka naam **text** ke tor par
  rakhta hai, customer record se **link nahi** karta. Is liye customers alag se
  import karna behtar hai (reporting sahi rahegi)
- **Purchase Orders aur Invoices** ka CSV import **support hi nahi** hai

---

## Recommended order

1. Pehle **customers** import karein
2. Phir **quotations** (type ke hisaab se alag file)
3. Har import se pehle **preview** dekh kar `recognisedColumns` verify karein
