import { expect, test, type Page } from "@playwright/test";

// Thursday 5 November 2026, midday: the demo data ends on this day.
const NOW = new Date("2026-11-05T12:00:00");

async function open(page: Page, hash = "") {
  await page.clock.install({ time: NOW });
  await page.addInitScript(() => localStorage.setItem("quarry:lang", JSON.stringify("en")));
  await page.goto(`./${hash}`);
  await expect(page.getByTestId("answer")).toBeVisible({ timeout: 30_000 });
}

const askBox = (page: Page) => page.getByRole("textbox", { name: /^(Ask|Sor)$/ });

async function ask(page: Page, q: string) {
  await askBox(page).fill(q);
  await askBox(page).press("Enter");
}

test("opens on an answer with a chart, the SQL and how the question was read", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("answer")).toContainText("11 periods. Peak: 2026-10");
  await expect(page.getByTestId("answer")).toContainText("2026-11 so far");
  await expect(page.getByRole("img", { name: /^Line chart of revenue by month/ })).toBeVisible();
  await expect(page.getByTestId("understood")).toContainText("Revenue: sum of invoice totals");
  await expect(page.getByRole("textbox", { name: "SQL" })).toHaveValue(/strftime\('%Y-%m', i\.issued_at\) AS month/);
});

test("answers an English question with a ranking", async ({ page }) => {
  await open(page);
  await ask(page, "top 5 customers by revenue last quarter");
  await expect(page.getByTestId("answer")).toContainText(/has the highest revenue: \$[\d,]+\. 5 rows\./);
  await expect(page.getByTestId("understood")).toContainText("Per customer");
  await expect(page.getByTestId("understood")).toContainText("Last quarter: issued 2026-07-01 → 2026-09-30");
  await page.getByRole("tab", { name: "Table" }).click();
  await expect(page.getByRole("table").locator("tbody tr")).toHaveCount(5);
});

test("answers in Turkish and switches the interface to Turkish", async ({ page }) => {
  await open(page);
  await ask(page, "son 6 ayda en çok harcayan 5 müşteri");
  await expect(page.getByTestId("answer")).toContainText("En yüksek ciro:");
  await expect(page.getByRole("button", { name: "Sor" })).toBeVisible();
  await expect(page.getByTestId("understood")).toContainText("Son 6 ay");
});

test("says so when a question has nothing to do with the data", async ({ page }) => {
  await open(page);
  await ask(page, "what's the weather in Paris tomorrow");
  await expect(page.getByText("I couldn't connect this to the data.")).toBeVisible();
});

test("runs hand-written SQL, explains it and flags mistakes", async ({ page }) => {
  await open(page);
  const editor = page.getByRole("textbox", { name: "SQL" });
  await editor.fill("SELECT country, COUNT(*) AS customers FROM customers WHERE status = NULL GROUP BY country");
  await editor.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("answer")).toContainText("No rows match.");
  await page.getByRole("tab", { name: /Explanation/ }).click();
  await expect(page.getByText('"= NULL" is never true. Use IS NULL.')).toBeVisible();
  await expect(page.getByText(/^Keeps rows where customer status is null/i)).toBeVisible();
});

test("asks before running SQL that changes data, and shows a helpful error for typos", async ({ page }) => {
  await open(page);
  const editor = page.getByRole("textbox", { name: "SQL" });
  await editor.fill("DELETE FROM invoices");
  await page.getByRole("button", { name: "Run" }).click();
  const dialog = page.getByRole("dialog", { name: "This changes data" });
  await expect(dialog).toContainText("This DELETE has no WHERE");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await editor.fill("SELECT custmer_id FROM invoices");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText("There is no column called “custmer_id”. Did you mean “customer_id” (in invoices)?")).toBeVisible();
});

test("uploads a CSV and answers questions about it", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Upload data" }).click();
  const csv = "Order ID;Customer;City;Order Date;Amount\n1;Ayşe Yılmaz;İzmir;03.01.2025;1.250,50\n2;Mehmet Öztürk;Ankara;15.01.2025;980,00\n3;Ayşe Yılmaz;İzmir;02.02.2025;2.400,75\n";
  await page.getByTestId("upload-input").setInputFiles({ name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  const dialog = page.getByRole("dialog", { name: "Use your own data" });
  await expect(dialog).toContainText("Loaded 1 table");
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await ask(page, "total amount by city");
  await expect(page.getByTestId("answer")).toContainText("İzmir");
  await page.getByRole("tab", { name: "Table" }).click();
  await expect(page.getByRole("table")).toContainText("3,651.25");
});

test("explains files it can't read", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Upload data" }).click();
  await page.getByTestId("upload-input").setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n") });
  await expect(page.getByRole("dialog", { name: "Use your own data" }).getByRole("alert")).toContainText("is a PDF");
});

test("shows the schema map and column profiles", async ({ page, isMobile }) => {
  await open(page);
  if (isMobile) await page.getByRole("button", { name: "Tables" }).click();
  await page.getByRole("button", { name: /^invoices [\d,]+$/ }).click();
  await page.getByRole("button", { name: /^status/ }).first().click();
  await expect(page.getByText(/^paid$/).first()).toBeVisible();
  await page.getByRole("button", { name: "Schema map" }).click();
  await expect(page.getByRole("img", { name: "Schema map: 7 tables, 6 relations" })).toBeVisible();
});

test("a shared link opens the same question", async ({ page }) => {
  await open(page, "#q=" + encodeURIComponent("revenue by segment"));
  await expect(page.getByTestId("answer")).toContainText("Corporate has the highest revenue");
});

test("exports the result as CSV", async ({ page, isMobile }) => {
  test.skip(isMobile, "Downloads are checked on desktop browsers.");
  await open(page);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV export" }).click()]);
  expect(download.suggestedFilename()).toBe("quarry-result.csv");
});

test("fits small screens without sideways scrolling", async ({ page }) => {
  await open(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
