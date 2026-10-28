import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { createResourceWorkbook } from "../src/lib/excel-export";
import { resources } from "../src/lib/resources";
import type { PageResult } from "../src/lib/api";

const context = { preparedBy: "Test Sales", scope: "Your permitted records only", filters: "Status: Completed | Branch: Jakarta", generatedAt: new Date("2026-10-28T10:00:00Z") };
const result: PageResult = {
  page: 2, pageSize: 10, total: 25, totalPages: 3,
  data: [{
    id: "test", name: '=HYPERLINK("https://example.invalid","test")', subject: "+SUM(1,1)", invoice: "INV-001",
    email: "customer@example.invalid", phone: "+628123456789", sku: "00123", customer: { name: "Customer One" },
    owner: { name: "Sales One" }, salesperson: { name: "Sales One" }, interest: "Apple iPhone 16",
    value: "15250000.50", total: "15250000.50", price: "15250000.50", probability: 75, stock: 5,
    stage: "WON", status: "COMPLETED", active: true, source: "WALK_IN", branch: "JAKARTA",
    soldAt: "2026-10-28T20:30:00Z", createdAt: "2026-10-28T20:30:00Z",
    updatedAt: "2026-10-28T20:30:00Z", dueAt: "2026-10-28T20:30:00Z", expectedCloseDate: "2026-10-28T20:30:00Z",
    password: "NEVER_EXPORT_THIS", passwordHash: "NEVER_EXPORT_THIS", token: "NEVER_EXPORT_THIS",
  }],
};

for (const resource of resources) {
  test(`${resource.key}: styled XLSX round-trips with scoped rows and no hidden private fields`, async () => {
    const workbook = createResourceWorkbook(resource, result, context);
    const bytes = await workbook.xlsx.writeBuffer();
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(bytes);
    const sheet = restored.worksheets[0]!;
    assert.equal(sheet.getCell("A1").value, "NOVA  /  RETAIL CRM");
    assert.equal(sheet.getCell("A2").value, resource.title);
    assert.match(String(sheet.getCell("A6").value), /Page 2 of 3.*1 exported \/ 25 matching/);
    assert.match(String(sheet.getCell("A6").value), /Your permitted records only/);
    assert.match(String(sheet.getCell("A7").value), /Branch: Jakarta/);
    assert.equal(sheet.getCell("A11").value, 11);
    assert.equal(sheet.getCell("B11").value, result.data[0]![resource.primary]);
    assert.equal(sheet.getCell("B11").type, ExcelJS.ValueType.String);
    assert.equal(sheet.getRow(10).height, 32);
    assert.deepEqual(sheet.getCell("B10").fill, { type: "pattern", pattern: "solid", fgColor: { argb: "14243B" } });
    assert.match(JSON.stringify(sheet.getCell("B10").border), /C6A46A/);
    assert.equal(sheet.views[0]!.state, "frozen");
    assert.ok(sheet.autoFilter);
    assert.equal(sheet.pageSetup.orientation, "landscape");
    assert.equal(sheet.pageSetup.fitToWidth, 1);
    assert.match(sheet.headerFooter.oddFooter!, /WIB/);
    assert.doesNotMatch(JSON.stringify(sheet.model), /NEVER_EXPORT_THIS/);
    const headers = sheet.getRow(10).values as ExcelJS.CellValue[];
    for (const column of resource.columns) {
      const label = column.format === "date" || column.format === "datetime" ? `${column.label} (WIB)` : column.label;
      const columnIndex = headers.indexOf(label);
      assert.ok(columnIndex > 0, label);
      const cell = sheet.getRow(11).getCell(columnIndex);
      if (column.format === "money") {
        assert.equal(cell.type, ExcelJS.ValueType.Number);
        assert.equal(cell.value, 15250000.5);
        assert.match(cell.numFmt, /Rp/);
        assert.deepEqual(sheet.getRow(12).getCell(columnIndex).value, {
          formula: `SUBTOTAL(109,${cell.address.replace("11", "")}11:${cell.address.replace("11", "")}11)`,
          result: 15250000.5,
        });
        assert.match(JSON.stringify(sheet.getRow(12).getCell(columnIndex).fill), /14243B/);
      }
      if (column.format === "percent") { assert.equal(cell.value, 0.75); assert.equal(cell.numFmt, "0.0%"); }
      if (column.format === "date" || column.format === "datetime") {
        assert.ok(cell.value instanceof Date);
        assert.equal(cell.value.toISOString(), "2026-10-29T03:30:00.000Z");
      }
    }
  });
}

test("phone and SKU remain strings; status cells have semantic styling", () => {
  const customers = createResourceWorkbook(resources.find(r => r.key === "customers")!, result, context).worksheets[0]!;
  const phoneIndex = (customers.getRow(10).values as ExcelJS.CellValue[]).indexOf("Phone");
  assert.equal(customers.getRow(11).getCell(phoneIndex).value, "+628123456789");
  const products = createResourceWorkbook(resources.find(r => r.key === "products")!, result, context).worksheets[0]!;
  assert.equal(products.getCell("C11").value, "00123");
  const activeColumn = (products.getRow(10).values as ExcelJS.CellValue[]).indexOf("Availability");
  assert.equal(products.getRow(11).getCell(activeColumn).value, "Active");
  assert.match(JSON.stringify(products.getRow(11).getCell(activeColumn).fill), /E7F3ED/);
});

test("alternating rows, empty reports and invalid numeric/date data", () => {
  const resource = resources.find(r => r.key === "opportunities")!;
  const sheet = createResourceWorkbook(resource, { ...result, data: [result.data[0]!, result.data[0]!] }, context).worksheets[0]!;
  assert.notDeepEqual(sheet.getCell("B11").fill, sheet.getCell("B12").fill);
  const empty = createResourceWorkbook(resource, { ...result, data: [], total: 0, page: 1, totalPages: 0 }, context);
  assert.ok(empty.worksheets[0]!.autoFilter);
  assert.throws(() => createResourceWorkbook(resource, { ...result, data: [{ id: "invalid", value: "bad" }] }, context), /Invalid numeric value/);
  assert.throws(() => createResourceWorkbook(resource, { ...result, data: [{ id: "invalid", expectedCloseDate: "bad" }] }, context), /Invalid date/);
});
