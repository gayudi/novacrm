ALTER TYPE "LeadSource" ADD VALUE 'INSTAGRAM';
ALTER TYPE "LeadSource" ADD VALUE 'FACEBOOK';
ALTER TYPE "LeadSource" ADD VALUE 'TIKTOK';
ALTER TYPE "OpportunityStage" ADD VALUE 'PROSPECTING';
ALTER TYPE "OpportunityStage" ADD VALUE 'QUALIFIED';
ALTER TYPE "ActivityType" ADD VALUE 'WHATSAPP';
ALTER TYPE "ActivityType" ADD VALUE 'STORE_VISIT';

CREATE TYPE "Branch" AS ENUM ('JAKARTA', 'BANDUNG', 'SURABAYA', 'MEDAN', 'SEMARANG');
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "customers"
  ADD COLUMN "branch" "Branch",
  ADD COLUMN "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "leads" ADD COLUMN "branch" "Branch";
ALTER TABLE "opportunities" ADD COLUMN "branch" "Branch", ADD COLUMN "lostReason" TEXT;
ALTER TABLE "activities" ADD COLUMN "branch" "Branch";
ALTER TABLE "sales_transactions" ADD COLUMN "branch" "Branch", ADD COLUMN "opportunityId" TEXT;

ALTER TABLE "sales_transactions" ADD CONSTRAINT "sales_transactions_opportunityId_fkey"
  FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "customers_branch_status_idx" ON "customers"("branch", "status");
CREATE INDEX "sales_transactions_opportunityId_idx" ON "sales_transactions"("opportunityId");
CREATE INDEX "sales_transactions_branch_soldAt_idx" ON "sales_transactions"("branch", "soldAt");

CREATE TABLE "seed_batches" (
  "id" TEXT PRIMARY KEY,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "counts" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
