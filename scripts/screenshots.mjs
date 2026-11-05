// Takes the README screenshots from the built site: npm run build && node scripts/serve.mjs, then this.
import { chromium } from "@playwright/test";

const base = process.env.URL ?? "http://localhost:4176/sql-copilot/";
const out = new URL("../docs/", import.meta.url).pathname;
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? "chrome" });

async function shot(name, { width = 1440, height = 960, dark = false, lang = "en", q = null, tab = null, mobile = false, after = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light", isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date("2026-11-05T12:00:00") });
  await page.addInitScript(([l, d]) => {
    localStorage.setItem("quarry:lang", JSON.stringify(l));
    localStorage.setItem("quarry:theme", d ? "dark" : "light");
  }, [lang, dark]);
  await page.goto(base + (q ? `#q=${encodeURIComponent(q)}` : ""));
  await page.getByTestId("answer").waitFor({ timeout: 30000 });
  if (tab) await page.getByRole("tab", { name: tab }).click();
  if (after) await after(page);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}${name}.png` });
  await ctx.close();
}

await shot("cover", { dark: false });
await shot("ranking-dark", { dark: true, q: "top 10 customers by revenue last quarter" });
await shot("turkish", { lang: "tr", q: "son 3 ayda hiç faturası olmayan müşteriler", tab: "Tablo" });
await shot("explain", {
  q: "average days to pay by segment",
  tab: "Explanation",
  after: async (page) => {
    await page.getByRole("textbox", { name: "SQL" }).fill("SELECT c.name, SUM(i.total)\nFROM customers c\nJOIN invoices i ON i.customer_id = c.id\nJOIN invoice_lines il ON il.invoice_id = i.id\nWHERE c.country = NULL\nGROUP BY c.name;");
    await page.getByRole("button", { name: "Run" }).click();
    await page.getByRole("tab", { name: /Explanation/ }).click();
  },
});
await shot("map", { after: async (page) => page.getByRole("button", { name: "Schema map" }).click() });
await shot("mobile", { width: 390, height: 844, mobile: true, q: "revenue by segment" });
await browser.close();
console.log("screenshots written to docs/");
