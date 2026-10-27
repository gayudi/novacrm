import type { Lookups } from "./api";

export type Field = {
  key: string; label: string; type?: "text" | "email" | "tel" | "number" | "textarea" | "select" | "reference" | "datetime-local" | "checkbox" | "password";
  required?: boolean; options?: string[]; lookup?: keyof Lookups; min?: number; max?: number; step?: number;
  defaultValue?: string | number | boolean; wide?: boolean; placeholder?: string;
};
export type Column = { key: string; label: string; format?: "badge" | "money" | "date" | "datetime" | "boolean" | "percent" | "stock" };
export type Resource = {
  key: string; title: string; singular: string; description: string; primary: string; secondary?: string;
  columns: Column[]; fields: Field[]; statuses?: string[]; restrictedWrite?: boolean;
};
const owner: Field = { key: "ownerId", label: "Assigned to", type: "reference", lookup: "users", required: true };
const customer: Field = { key: "customerId", label: "Customer", type: "reference", lookup: "customers", required: true };
const notes: Field = { key: "notes", label: "Notes", type: "textarea", wide: true, placeholder: "Add helpful context for your team..." };
const name: Field = { key: "name", label: "Full name", required: true };
const email: Field = { key: "email", label: "Email address", type: "email" };
const phone: Field = { key: "phone", label: "Phone number", type: "tel", required: true, placeholder: "+62 812 3456 7890" };
const branch: Field = { key: "branch", label: "Branch", type: "select", options: ["", "JAKARTA", "BANDUNG", "SURABAYA", "MEDAN", "SEMARANG"] };
const branchColumn: Column = { key: "branch", label: "Branch", format: "badge" };
const leadStatuses = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"];
const stages = ["PROSPECTING", "QUALIFIED", "PROPOSAL", "NEGOTIATION", "WON", "LOST", "QUALIFICATION", "NEEDS_ANALYSIS"];
const activityStatuses = ["PLANNED", "COMPLETED", "CANCELLED"];
const transactionStatuses = ["COMPLETED", "PENDING", "CANCELLED"];

export const resources: Resource[] = [
  {
    key: "customers", title: "Customers", singular: "customer", primary: "name", secondary: "email", statuses: ["ACTIVE", "INACTIVE"],
    description: "Know your customers. Build relationships that go beyond the sale.",
    columns: [{ key: "phone", label: "Phone" }, branchColumn, { key: "segment", label: "Segment", format: "badge" }, { key: "status", label: "Status", format: "badge" }, { key: "owner.name", label: "Assigned to" }],
    fields: [name, email, phone, { key: "city", label: "City", required: true }, branch, { key: "status", label: "Customer status", type: "select", options: ["ACTIVE", "INACTIVE"], required: true }, { key: "segment", label: "Segment", type: "select", options: ["REGULAR", "VIP", "CORPORATE"], required: true }, owner, { key: "address", label: "Address", wide: true }, notes],
  },
  {
    key: "contacts", title: "Contacts", singular: "contact", primary: "name", secondary: "email",
    description: "The people behind every customer relationship, all in one place.",
    columns: [{ key: "phone", label: "Phone" }, { key: "title", label: "Title / relationship" }, { key: "customer.name", label: "Customer" }, { key: "createdAt", label: "Added", format: "date" }],
    fields: [name, email, phone, { key: "title", label: "Title / relationship", placeholder: "e.g. Purchasing manager" }, customer],
  },
  {
    key: "leads", title: "Leads", singular: "lead", primary: "name", secondary: "email", statuses: leadStatuses,
    description: "Newest leads first, by creation time. Dates and times are shown in WIB.",
    columns: [{ key: "interest", label: "Product interest" }, { key: "source", label: "Source", format: "badge" }, { key: "status", label: "Status", format: "badge" }, branchColumn, { key: "owner.name", label: "Assigned to" }, { key: "createdAt", label: "Created", format: "datetime" }, { key: "updatedAt", label: "Last updated", format: "datetime" }],
    fields: [name, email, phone, { key: "interest", label: "Product interest", placeholder: "e.g. Apple iPhone 16" }, { key: "source", label: "Lead source", type: "select", options: ["WALK_IN", "WEBSITE", "INSTAGRAM", "FACEBOOK", "REFERRAL", "MARKETPLACE", "TIKTOK", "SOCIAL_MEDIA", "EVENT"], required: true }, { key: "status", label: "Status", type: "select", options: leadStatuses, required: true }, owner, branch, { ...customer, required: false }, notes],
  },
  {
    key: "opportunities", title: "Opportunities", singular: "opportunity", primary: "name", secondary: "customer.name", statuses: stages,
    description: "A clear view of every deal. A confident next step for your team.",
    columns: [{ key: "value", label: "Deal value", format: "money" }, { key: "stage", label: "Stage", format: "badge" }, branchColumn, { key: "probability", label: "Probability", format: "percent" }, { key: "expectedCloseDate", label: "Expected close", format: "date" }],
    fields: [{ key: "name", label: "Opportunity name", required: true, wide: true }, customer, owner, branch, { key: "value", label: "Deal value (IDR)", type: "number", min: 0, max: 1e12, step: 0.01, required: true }, { key: "stage", label: "Stage", type: "select", options: stages, required: true }, { key: "probability", label: "Win probability (%)", type: "number", min: 0, max: 100, defaultValue: 20, required: true }, { key: "expectedCloseDate", label: "Expected close", type: "datetime-local", required: true }, { key: "lostReason", label: "Lost reason", placeholder: "For lost deals: price, financing, stock, timing..." }, notes],
  },
  {
    key: "activities", title: "Activities", singular: "activity", primary: "subject", secondary: "customer.name", statuses: activityStatuses,
    description: "Every conversation counts. Keep your follow-ups moving forward.",
    columns: [{ key: "type", label: "Type", format: "badge" }, { key: "dueAt", label: "Due date", format: "date" }, { key: "status", label: "Status", format: "badge" }, branchColumn, { key: "owner.name", label: "Assigned to" }],
    fields: [{ key: "subject", label: "Subject", required: true, wide: true }, { key: "type", label: "Activity type", type: "select", options: ["CALL", "EMAIL", "WHATSAPP", "MEETING", "STORE_VISIT", "FOLLOW_UP", "TASK"], required: true }, { key: "status", label: "Status", type: "select", options: activityStatuses, required: true }, { key: "dueAt", label: "Due date & time", type: "datetime-local", required: true }, owner, branch, { ...customer, required: false }, { key: "opportunityId", label: "Opportunity", type: "reference", lookup: "opportunities" }, notes],
  },
  {
    key: "products", title: "Products", singular: "product", primary: "name", secondary: "sku", restrictedWrite: true,
    description: "The latest devices. The right price. Your entire catalogue, connected.",
    columns: [{ key: "brand", label: "Brand" }, { key: "price", label: "Price", format: "money" }, { key: "stock", label: "In stock", format: "stock" }, { key: "active", label: "Availability", format: "boolean" }],
    fields: [{ key: "name", label: "Product name", required: true, wide: true }, { key: "sku", label: "SKU", required: true }, { key: "brand", label: "Brand", required: true }, { key: "category", label: "Category", defaultValue: "Smartphone", required: true }, { key: "price", label: "Price (IDR)", type: "number", min: 0.01, max: 1e12, step: 0.01, required: true }, { key: "stock", label: "Available stock", type: "number", min: 0, max: 1000000, defaultValue: 0, required: true }, { key: "active", label: "Available for new sales", type: "checkbox", defaultValue: true }, { key: "description", label: "Specifications / description", type: "textarea", wide: true }],
  },
  {
    key: "transactions", title: "Sales transactions", singular: "transaction", primary: "invoice", secondary: "customer.name", statuses: transactionStatuses,
    description: "From checkout to customer loyalty. Every sale, accounted for.",
    columns: [{ key: "total", label: "Total", format: "money" }, { key: "status", label: "Status", format: "badge" }, branchColumn, { key: "salesperson.name", label: "Salesperson" }, { key: "soldAt", label: "Sale date", format: "datetime" }],
    fields: [customer, { ...owner, key: "salespersonId", label: "Salesperson" }, branch, { key: "opportunityId", label: "Opportunity", type: "reference", lookup: "opportunities" }, { key: "soldAt", label: "Sale date", type: "datetime-local", required: true }, { key: "status", label: "Status", type: "select", options: transactionStatuses, required: true }, notes],
  },
  {
    key: "users", title: "Team management", singular: "team member", primary: "name", secondary: "email",
    description: "Give your people the right access to do their best work.",
    columns: [{ key: "role", label: "Role", format: "badge" }, { key: "active", label: "Account", format: "boolean" }, { key: "createdAt", label: "Joined", format: "date" }],
    fields: [name, { ...email, required: true }, { key: "password", label: "Password", type: "password", required: true, placeholder: "At least 12 characters" }, { key: "role", label: "Role", type: "select", options: ["SALES", "MANAGER", "ADMIN"], required: true }, { key: "active", label: "Account enabled", type: "checkbox", defaultValue: true }],
  },
];

export function getValue(record: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" && key in value ? (value as Record<string, unknown>)[key] : undefined, record);
}
