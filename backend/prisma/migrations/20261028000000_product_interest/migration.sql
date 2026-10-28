ALTER TABLE "leads" ADD COLUMN "productId" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "productId" TEXT;

CREATE INDEX "leads_productId_idx" ON "leads"("productId");
CREATE INDEX "opportunities_productId_idx" ON "opportunities"("productId");

ALTER TABLE "leads" ADD CONSTRAINT "leads_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "leads" AS l
SET "productId" = matches.id
FROM (
  SELECT lower(trim(name)) AS name, min(id) AS id
  FROM "products"
  GROUP BY lower(trim(name))
  HAVING count(*) = 1
) AS matches
WHERE lower(trim(l.interest)) = matches.name;
