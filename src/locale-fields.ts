import * as z from "zod"

/**
 * The locale and currency fields every chart call shares: the legacy tool inputs and chart documents use these same
 * schemas, and resolveLocale uses the same currency table. No file access, so the document core can import it.
 */

/** ISO 4217 codes the plugin formats, with the symbol each uses. */
export const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", INR: "₹", BRL: "R$", CHF: "CHF", SEK: "kr", NOK: "kr", DKK: "kr", PLN: "zł", KRW: "₩", RUB: "₽",
  TRY: "₺", AUD: "A$", CAD: "CA$", NZD: "NZ$", ZAR: "R", MXN: "MX$", CZK: "Kč", HUF: "Ft", ILS: "₪", HKD: "HK$", SGD: "S$", AED: "AED", SAR: "SAR", NGN: "₦", KES: "KSh", IDR: "Rp", THB: "฿", VND: "₫", PHP: "₱", UAH: "₴",
}

export const LOCALE_FIELD = z.string().max(16).optional().describe("Number and date formats, such as en-GB or de-DE. Default en-US.")
export const CURRENCY_FIELD = z.string().length(3).optional().describe("ISO 4217 code (EUR, USD, GBP…): money-like fields get it, in compact form (€1.2M).")

/** Whether a currency code (any case) is one the plugin formats: the check resolveLocale makes at render time. */
export const isKnownCurrency = (code: string) => Object.hasOwn(CURRENCY_SYMBOLS, code.toUpperCase())
