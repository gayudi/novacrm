import ExcelJS from "exceljs";
import type { EntityRecord, PageResult } from "./api";
import { getValue, type Column, type Resource } from "./resources";
import { humanize } from "./utils";

const colors = { navy: "14243B", gold: "C6A46A", ink: "26374D", muted: "69788C", line: "E4EAF1", pale: "F3F6FA", white: "FFFFFF" };
const currencyFormat = '"Rp" #,##0.00;[Red]("Rp" #,##0.00);"-"';
const headerRow = 10;

export type ExportContext = {
  preparedBy: string;
  scope: string;
  filters: string;
  generatedAt?: Date;
};

function typedValue(value: unknown, column: Column): string | number | null {
  if (value === undefined || value === null || value === "") return null;
  if (column.format === "money" || column.format === "percent" || column.format === "stock") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`Invalid numeric value in ${column.label}.`);
    return column.format === "percent" ? number / 100 : number;
  }
  if (column.format === "date" || column.format === "datetime") {
    const date = new Date(String(value));
    if (!Number.isFinite(date.getTime())) throw new Error(`Invalid date in ${column.label}.`);
    // Excel dates have no timezone; store the WIB wall-clock time, independent of the browser timezone.
    return (date.getTime() + 7 * 60 * 60 * 1000) / 86_400_000 + 25569;
  }
  if (column.format === "boolean") return value ? "Active" : "Inactive";
  if (column.format === "badge") return humanize(String(value));
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid numeric value in ${column.label}.`);
    return value;
  }
  // Plain string cells deliberately never become formulas or hyperlinks.
  return String(value);
}

function statusColors(value: unknown): { fill: string; text: string } | undefined {
  if (value === true || ["ACTIVE", "COMPLETED", "WON", "CONVERTED", "QUALIFIED"].includes(String(value))) return { fill: "E7F3ED", text: "23654A" };
  if (value === false || ["LOST", "CANCELLED", "INACTIVE"].includes(String(value))) return { fill: "FBECEE", text: "A03C50" };
  if (["PENDING", "NEGOTIATION", "PLANNED"].includes(String(value))) return { fill: "FFF3DC", text: "8B631B" };
  return undefined;
}

export function createResourceWorkbook(resource: Resource, result: PageResult, context: ExportContext) {
  const generatedAt = context.generatedAt ?? new Date();
  const columns: Column[] = [
    { key: resource.primary, label: humanize(resource.singular) },
    ...(resource.secondary ? [{ key: resource.secondary, label: resource.secondary.endsWith("email") ? "Email address" : resource.secondary === "sku" ? "SKU" : "Customer" }] : []),
    ...resource.columns,
  ];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Nova Retail CRM";
  workbook.lastModifiedBy = context.preparedBy;
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.title = `${resource.title} | Nova Retail CRM`;
  workbook.subject = "Permission-scoped CRM report - current page";
  const sheet = workbook.addWorksheet(resource.title.slice(0, 31), {
    properties: { defaultRowHeight: 24 },
    views: [{ state: "frozen", ySplit: headerRow, xSplit: 1, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    headerFooter: { oddHeader: "&L&B NOVA | RETAIL CRM&RConfidential", oddFooter: "&LInternal business report&CPage &P of &N&RAll dates: WIB (UTC+7)" },
  });
  const width = columns.length + 1;
  sheet.getColumn(1).width = 7;
  columns.forEach((column, index) => {
    sheet.getColumn(index + 2).width = column.format === "money" ? 25 : column.format === "datetime" ? 25 : column.key === resource.primary ? 38 : column.key.includes("email") ? 34 : column.label.includes("interest") ? 32 : 23;
  });
  const banner = (rowNumber: number, text: string, size: number, fill: string, textColor: string, height: number) => {
    sheet.mergeCells(rowNumber, 1, rowNumber, width);
    const cell = sheet.getCell(rowNumber, 1);
    cell.value = text;
    cell.font = { name: "Aptos", size, bold: rowNumber < 4, color: { argb: textColor } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    cell.alignment = { vertical: "middle", indent: 1, wrapText: true };
    sheet.getRow(rowNumber).height = height;
  };
  banner(1, "NOVA  /  RETAIL CRM", 12, colors.navy, colors.gold, 32);
  banner(2, resource.title, 24, colors.navy, colors.white, 44);
  banner(3, "BUSINESS REPORT  |  CURRENT PAGE", 10, colors.navy, colors.gold, 27);
  const timestamp = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(generatedAt);
  banner(5, `PREPARED BY  ${context.preparedBy}   |   ${timestamp} WIB`, 10, colors.white, colors.ink, 26);
  banner(6, `SCOPE  ${context.scope}   |   Page ${result.page} of ${Math.max(1, result.totalPages)}   |   ${result.data.length} exported / ${result.total} matching records`, 10, colors.pale, colors.ink, 28);
  banner(7, `FILTERS  ${context.filters}`, 10, colors.white, colors.muted, 38);
  banner(8, "Current page only. Monetary totals cover exported rows, not the entire workspace. Dates are in WIB (UTC+7).", 10, colors.white, colors.muted, 30);
  const header = sheet.getRow(headerRow);
  header.values = ["No.", ...columns.map(column => column.format === "date" || column.format === "datetime" ? `${column.label} (WIB)` : column.label)];
  header.height = 32;
  header.eachCell(cell => {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: colors.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.navy } };
    cell.alignment = { vertical: "middle", wrapText: true, indent: 1 };
    cell.border = { bottom: { style: "medium", color: { argb: colors.gold } } };
  });
  result.data.forEach((record: EntityRecord, index) => {
    const row = sheet.addRow([(result.page - 1) * result.pageSize + index + 1, ...columns.map(column => typedValue(getValue(record, column.key), column))]);
    row.height = 38;
    Array.from({ length: width }, (_, cellIndex) => row.getCell(cellIndex + 1)).forEach((cell, cellIndex) => {
      const cellNumber = cellIndex + 1;
      const column = columns[cellNumber - 2];
      cell.font = { name: "Aptos", size: 11, color: { argb: colors.ink }, bold: cellNumber === 2 || column?.format === "money" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 === 0 ? colors.white : colors.pale } };
      cell.border = { bottom: { style: "hair", color: { argb: colors.line } } };
      const numeric = typeof cell.value === "number";
      cell.alignment = { vertical: "middle", wrapText: true, horizontal: numeric ? "right" : "left", indent: 1 };
      if (column?.format === "money") cell.numFmt = currencyFormat;
      else if (column?.format === "percent") cell.numFmt = "0.0%";
      else if (column?.format === "stock") cell.numFmt = '#,##0" units"';
      else if (column?.format === "date") cell.numFmt = "dd mmm yyyy";
      else if (column?.format === "datetime") cell.numFmt = "dd mmm yyyy hh:mm";
      if (column?.format === "badge" || column?.format === "boolean") {
        const status = statusColors(getValue(record, column.key));
        if (status) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: status.fill } };
          cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: status.text } };
        }
      }
    });
  });
  const lastDataRow = headerRow + result.data.length;
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, lastDataRow), column: width } };
  const totalRow = sheet.addRow(["", "PAGE TOTAL", ...columns.slice(1).map(() => null)]);
  totalRow.height = 32;
  Array.from({ length: width }, (_, index) => totalRow.getCell(index + 1)).forEach(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.navy } };
    cell.font = { name: "Aptos", bold: true, size: 11, color: { argb: colors.white } };
    cell.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
    cell.border = { top: { style: "medium", color: { argb: colors.gold } } };
  });
  columns.forEach((column, index) => {
    if (column.format !== "money") return;
    const cell = totalRow.getCell(index + 2);
    const letter = sheet.getColumn(index + 2).letter;
    const total = result.data.reduce((sum, record) => sum + Number(getValue(record, column.key) ?? 0), 0);
    cell.value = result.data.length ? { formula: `SUBTOTAL(109,${letter}${headerRow + 1}:${letter}${lastDataRow})`, result: total } : 0;
    cell.numFmt = currencyFormat;
  });
  banner(totalRow.number + 2, "NOVA RETAIL CRM  |  Confidential - internal use only  |  Export respects your CRM access permissions.", 9, colors.pale, colors.muted, 28);
  sheet.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(width).letter}${totalRow.number + 2}`;
  return workbook;
}

export async function downloadResourceExcel(resource: Resource, result: PageResult, context: ExportContext) {
  const workbook = createResourceWorkbook(resource, result, context);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `nova-${resource.key}-page-${result.page}.xlsx`;
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
