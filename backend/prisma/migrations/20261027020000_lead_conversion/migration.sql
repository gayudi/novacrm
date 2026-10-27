ALTER TABLE "leads"
  ADD COLUMN "convertedAt" TIMESTAMP(3),
  ADD COLUMN "convertedOpportunityId" TEXT;

CREATE UNIQUE INDEX "leads_convertedOpportunityId_key" ON "leads"("convertedOpportunityId");

ALTER TABLE "leads" ADD CONSTRAINT "leads_convertedOpportunityId_fkey"
  FOREIGN KEY ("convertedOpportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leads" ADD CONSTRAINT "leads_conversion_consistent"
  CHECK (
    ("convertedAt" IS NULL AND "convertedOpportunityId" IS NULL)
    OR ("convertedAt" IS NOT NULL AND "convertedOpportunityId" IS NOT NULL AND "status" = 'CONVERTED')
  );
