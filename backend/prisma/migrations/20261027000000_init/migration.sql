-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('ADMIN', 'MANAGER', 'SALES');

-- CreateEnum
CREATE TYPE "public"."LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "public"."LeadSource" AS ENUM ('WALK_IN', 'WEBSITE', 'SOCIAL_MEDIA', 'REFERRAL', 'MARKETPLACE', 'EVENT');

-- CreateEnum
CREATE TYPE "public"."OpportunityStage" AS ENUM ('QUALIFICATION', 'NEEDS_ANALYSIS', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "public"."ActivityType" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'TASK', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "public"."ActivityStatus" AS ENUM ('PLANNED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."TransactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "public"."Role" NOT NULL DEFAULT 'SALES',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "segment" TEXT NOT NULL DEFAULT 'REGULAR',
    "notes" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contacts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "title" TEXT,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "source" "public"."LeadSource" NOT NULL DEFAULT 'WALK_IN',
    "status" "public"."LeadStatus" NOT NULL DEFAULT 'NEW',
    "interest" TEXT,
    "notes" TEXT,
    "customerId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."opportunities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" "public"."OpportunityStage" NOT NULL DEFAULT 'QUALIFICATION',
    "value" DECIMAL(18,2) NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 20,
    "expectedCloseDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "customerId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."activities" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "type" "public"."ActivityType" NOT NULL DEFAULT 'TASK',
    "status" "public"."ActivityStatus" NOT NULL DEFAULT 'PLANNED',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "customerId" TEXT,
    "opportunityId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Smartphone',
    "description" TEXT,
    "price" DECIMAL(18,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sales_transactions" (
    "id" TEXT NOT NULL,
    "invoice" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "status" "public"."TransactionStatus" NOT NULL DEFAULT 'COMPLETED',
    "soldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sales_transaction_items" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "sales_transaction_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "public"."customers"("email");

-- CreateIndex
CREATE INDEX "customers_ownerId_idx" ON "public"."customers"("ownerId");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "public"."customers"("name");

-- CreateIndex
CREATE INDEX "contacts_customerId_idx" ON "public"."contacts"("customerId");

-- CreateIndex
CREATE INDEX "leads_ownerId_idx" ON "public"."leads"("ownerId");

-- CreateIndex
CREATE INDEX "leads_status_source_idx" ON "public"."leads"("status", "source");

-- CreateIndex
CREATE INDEX "opportunities_stage_idx" ON "public"."opportunities"("stage");

-- CreateIndex
CREATE INDEX "opportunities_ownerId_idx" ON "public"."opportunities"("ownerId");

-- CreateIndex
CREATE INDEX "opportunities_customerId_idx" ON "public"."opportunities"("customerId");

-- CreateIndex
CREATE INDEX "activities_dueAt_status_idx" ON "public"."activities"("dueAt", "status");

-- CreateIndex
CREATE INDEX "activities_ownerId_idx" ON "public"."activities"("ownerId");

-- CreateIndex
CREATE INDEX "activities_customerId_idx" ON "public"."activities"("customerId");

-- CreateIndex
CREATE INDEX "activities_opportunityId_idx" ON "public"."activities"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "public"."products"("sku");

-- CreateIndex
CREATE INDEX "products_brand_idx" ON "public"."products"("brand");

-- CreateIndex
CREATE UNIQUE INDEX "sales_transactions_invoice_key" ON "public"."sales_transactions"("invoice");

-- CreateIndex
CREATE INDEX "sales_transactions_soldAt_status_idx" ON "public"."sales_transactions"("soldAt", "status");

-- CreateIndex
CREATE INDEX "sales_transactions_customerId_idx" ON "public"."sales_transactions"("customerId");

-- CreateIndex
CREATE INDEX "sales_transactions_salespersonId_idx" ON "public"."sales_transactions"("salespersonId");

-- CreateIndex
CREATE INDEX "sales_transaction_items_productId_idx" ON "public"."sales_transaction_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_transaction_items_transactionId_productId_key" ON "public"."sales_transaction_items"("transactionId", "productId");

-- AddForeignKey
ALTER TABLE "public"."customers" ADD CONSTRAINT "customers_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contacts" ADD CONSTRAINT "contacts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."opportunities" ADD CONSTRAINT "opportunities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."opportunities" ADD CONSTRAINT "opportunities_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activities" ADD CONSTRAINT "activities_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activities" ADD CONSTRAINT "activities_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "public"."opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activities" ADD CONSTRAINT "activities_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_transactions" ADD CONSTRAINT "sales_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_transactions" ADD CONSTRAINT "sales_transactions_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_transaction_items" ADD CONSTRAINT "sales_transaction_items_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "public"."sales_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."sales_transaction_items" ADD CONSTRAINT "sales_transaction_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
