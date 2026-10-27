import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export function money(value: number | string, compact = false) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency", currency: "IDR", maximumFractionDigits: 0,
    ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
  }).format(Number(value));
}
export function shortMoney(value: number) {
  if (value >= 1e9) return `Rp ${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `Rp ${(value / 1e6).toFixed(1)}M`;
  return money(value);
}
export function humanize(value: string) {
  if (value === "WHATSAPP") return "WhatsApp";
  if (value === "TIKTOK") return "TikTok";
  return value.toLowerCase().split("_").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
export function initials(name: string) { return name.split(" ").slice(0, 2).map(s => s[0]).join("").toUpperCase(); }
export function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(date));
}
export function dateTimeLabel(date: string) {
  return `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(date))} WIB`;
}
export function localDateTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
