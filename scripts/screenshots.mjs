// Takes the README screenshots from the built site: npm run build && node scripts/serve.mjs, then this.
import { chromium } from "@playwright/test";

const base = process.env.URL ?? "http://localhost:4176/sql-copilot/";
const out = new URL("../docs/", import.meta.url).pathname;
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? "chrome" });

async function shot(name, { width = 1440, height = 900, dark = false, lang = "en", hash = "", steps = null, mobile = false, full = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light", isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date("2026-11-05T12:00:00") });
  await page.addInitScript(([l, d]) => {
    if (sessionStorage.getItem("seeded")) return;
    localStorage.clear();
    localStorage.setItem("quarry:lang", JSON.stringify(l));
    localStorage.setItem("quarry:theme", d ? "dark" : "light");
    sessionStorage.setItem("seeded", "1");
  }, [lang, dark]);
  await page.goto(base + hash);
  await page.getByRole("combobox", { name: /^(Ask|Sor)$/ }).waitFor({ timeout: 30000 });
  if (steps) await steps(page);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}${name}.png`, fullPage: full });
  await ctx.close();
}

const ask = async (page, q) => {
  const box = page.getByRole("combobox", { name: /^(Ask|Sor)$/ });
  const n = await page.getByTestId("answer-card").count();
  await box.fill(q);
  await box.press("Escape");
  await box.press("Enter");
  await page.getByTestId("answer-card").nth(n).waitFor();
};
const nav = (page, name) => page.getByRole("navigation", { name: /Sections|Bölümler/ }).first().getByRole("button", { name }).click();

await shot("cover");
await shot("thread-dark", {
  dark: true,
  steps: async (page) => {
    await ask(page, "top 5 customers by revenue last quarter");
    await ask(page, "what about last year?");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByTestId("answer-card").first().getByRole("button", { name: "Remove" }).click();
  },
});
await shot("dashboard", { steps: async (page) => nav(page, /Dashboard/) });
await shot("sql-dark", {
  dark: true,
  steps: async (page) => {
    await nav(page, /^SQL$/);
    const ed = page.getByRole("textbox", { name: "SQL" });
    await ed.fill("SELECT c.name, SUM(i.total) AS revenue\nFROM customers c\nJOIN invoices i ON i.customer_id = c.id\nJOIN invoice_lines il ON il.invoice_id = i.id\nWHERE c.country = NULL\nGROUP BY c.name;");
    await page.getByRole("button", { name: /^Run\b/ }).click();
    await page.getByRole("tab", { name: /Explanation/ }).click();
  },
});
await shot("data", { steps: async (page) => { await nav(page, /^Data$/); await page.getByRole("tab", { name: /Measures/ }).click(); } });
await shot("turkish", { lang: "tr", steps: async (page) => { await ask(page, "segmentlere göre ortalama ödeme süresi"); } });
await shot("mobile", { width: 390, height: 844, mobile: true, steps: async (page) => { await ask(page, "monthly revenue this year"); } });
await browser.close();
console.log("screenshots written to docs/");
