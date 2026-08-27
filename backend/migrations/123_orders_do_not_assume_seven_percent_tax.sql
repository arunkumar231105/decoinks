-- orders.tax_pct ka default 7 tha. Kisi ne kabhi tax wasool nahi ki — 123 orders
-- aur 114 invoices, sab ka tax_amt sifar, kul tax $0.00 — magar jo bhi order
-- tax_pct diye baghair banta, database khud us par 7 likh deta. Paanch orders is
-- tarah 7% le kar baithe the aur screen par "Tax (7%)" dikhate rahe, us ke
-- saamne $0.00 ke saath.
--
-- Yeh sirf orders par tha. invoices aur quotations dono par default pehle se 0
-- hai, is liye default 7 kisi soche samjhe faisle ka nateeja nahi, ek chhoot gaya
-- number lagta hai — aur sab se ulta asar wahan hua jahan orders app ke bahar se
-- bane.
--
-- Default 0 hota hai. Column rehta hai: agar kabhi tax lagani pare to jagah
-- mojood rahegi, bas ab wo khud se nahi aayegi.
ALTER TABLE orders ALTER COLUMN tax_pct SET DEFAULT 0;

COMMENT ON COLUMN orders.tax_pct IS
  'Tax ki sharah. Default 0 — tax tab hi lagti hai jab koi jaan bujh kar lagaye.';
