import { expect, test, type Page } from "@playwright/test";

// Thursday 5 November 2026, midday: the demo data ends on this day.
const NOW = new Date("2026-11-05T12:00:00");

async function open(page: Page, hash = "", lang = "en") {
  await page.clock.install({ time: NOW });
  await page.addInitScript((l) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.clear();
      localStorage.setItem("quarry:lang", JSON.stringify(l));
      sessionStorage.setItem("seeded", "1");
    }
  }, lang);
  await page.goto(`./${hash}`);
  await expect(page.getByRole("combobox", { name: /^(Ask|Sor)$/ })).toBeVisible({ timeout: 30_000 });
}

const askBox = (page: Page) => page.getByRole("combobox", { name: /^(Ask|Sor)$/ });
const cards = (page: Page) => page.getByTestId("answer-card");
const lastCard = (page: Page) => cards(page).last();

async function ask(page: Page, q: string) {
  const n = await cards(page).count();
  await askBox(page).fill(q);
  await askBox(page).press("Escape");
  await askBox(page).press("Enter");
  await expect(cards(page)).toHaveCount(n + 1);
}

async function go(page: Page, name: RegExp) {
  await page.getByRole("navigation", { name: "Sections" }).filter({ visible: true }).first().getByRole("button", { name }).click();
}

test("opens on a welcome with live numbers and starter questions", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { name: "What would you like to know?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Revenue this year \$[\d.]+M/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /vs the same dates last year/ })).toBeVisible();
  await page.getByRole("button", { name: "Top 5 customers by revenue last quarter" }).click();
  await expect(lastCard(page).getByTestId("answer")).toHaveText(/^[\w &.-]+ has the highest revenue: \$[\d,]+\.$/);
  await expect(lastCard(page).getByTestId("understood")).toContainText("Last quarter: issued 2026-07-01 → 2026-09-30");
  await expect(lastCard(page).getByRole("img", { name: /^Bar chart of revenue by customer/ })).toBeVisible();
});

test("follow-up questions build on the last answer", async ({ page }) => {
  await open(page);
  await ask(page, "top 5 customers by revenue last quarter");
  await lastCard(page).getByRole("button", { name: "what about last year?" }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(lastCard(page)).toContainText("follow-up");
  await expect(lastCard(page).getByTestId("understood")).toContainText("Last year: issued 2025-01-01 → 2025-12-31");
  await expect(lastCard(page).getByTestId("understood")).toContainText("Top 5");
  await ask(page, "only Germany");
  await expect(lastCard(page).getByTestId("understood")).toContainText("Country is Germany");
  await lastCard(page).getByRole("tab", { name: "SQL" }).click();
  await expect(lastCard(page).getByRole("textbox", { name: "SQL" })).toHaveValue(/c\.country = 'Germany'[\s\S]*BETWEEN '2025-01-01' AND '2025-12-31'[\s\S]*LIMIT 5/);
});

test("answers in Turkish, switches the interface and compares with the period before", async ({ page }) => {
  await open(page);
  await ask(page, "geçen çeyrek ciro");
  await expect(page.getByRole("combobox", { name: "Sor" })).toBeVisible();
  await expect(lastCard(page).getByTestId("answer")).toContainText("Ciro");
  await expect(lastCard(page).getByTestId("insights")).toContainText("Önceki döneme göre");
});

test("says so when a question has nothing to do with the data", async ({ page }) => {
  await open(page);
  await ask(page, "what's the weather in Paris tomorrow");
  await expect(lastCard(page).getByRole("alert")).toContainText("I couldn't connect this to the data.");
});

test("suggests tables, measures and values while typing", async ({ page }) => {
  await open(page);
  await askBox(page).pressSequentially("top 5 cust");
  await expect(page.getByRole("option", { name: /customers/ }).first()).toBeVisible();
  await askBox(page).press("Tab");
  await expect(askBox(page)).toHaveValue("top 5 customers ");
});

test("the SQL editor completes names, formats, explains and flags mistakes", async ({ page }) => {
  await open(page);
  await go(page, /^SQL$/);
  const editor = page.getByRole("textbox", { name: "SQL" });
  await editor.fill("select c.country, count(*) as n from customers c where c.status = null group by c.country");
  await page.getByRole("button", { name: "Format" }).click();
  await expect(editor).toHaveValue("SELECT\n  c.country,\n  count(*) AS n\nFROM customers c\nWHERE\n  c.status = NULL\nGROUP BY c.country;");
  await editor.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("answer")).toContainText("No rows match.");
  await page.getByRole("tab", { name: /Explanation/ }).click();
  await expect(page.getByText('"= NULL" is never true. Use IS NULL.')).toBeVisible();
  await editor.fill("SELECT * FROM invoices AS i WHERE i.");
  await editor.pressSequentially("st");
  await expect(page.getByRole("option", { name: /status/ })).toBeVisible();
  await editor.press("Tab");
  await expect(editor).toHaveValue("SELECT * FROM invoices AS i WHERE i.status");
});

test("asks before running SQL that changes data", async ({ page }) => {
  await open(page);
  await go(page, /^SQL$/);
  await page.getByRole("textbox", { name: "SQL" }).fill("DELETE FROM invoices");
  await page.getByRole("button", { name: /^Run/ }).click();
  const dialog = page.getByRole("dialog", { name: "This changes data" });
  await expect(dialog).toContainText("This DELETE has no WHERE");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("textbox", { name: "SQL" }).fill("SELECT custmer_id FROM invoices");
  await page.getByRole("button", { name: /^Run/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Did you mean" })).toContainText("Did you mean “customer_id” (in invoices)?");
});

test("pins an answer to the dashboard, which starts with a finance overview", async ({ page }) => {
  await open(page);
  await ask(page, "revenue by country this year");
  await lastCard(page).getByRole("button", { name: "Pin to dashboard" }).click();
  await go(page, /Dashboard/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  for (const k of ["Revenue this year", "Outstanding", "Overdue", "Average days to pay"]) await expect(page.getByRole("button", { name: new RegExp(`^${k}`) })).toBeVisible();
  await expect(page.getByRole("region", { name: "Monthly revenue, last 12 months" })).toBeVisible();
  await expect(page.getByRole("region", { name: "revenue by country this year" })).toBeVisible();
});

test("learns a word from the user", async ({ page }) => {
  await open(page);
  await go(page, /^Data$/);
  await page.getByRole("tab", { name: /Taught words/ }).click();
  await page.getByLabel("When I say").fill("enterprise");
  await page.getByLabel("I mean").selectOption({ label: "segment = Corporate" });
  await page.getByRole("button", { name: "Teach", exact: true }).click();
  await expect(page.getByText("“enterprise”").first()).toBeVisible();
  await go(page, /^Ask$/);
  await ask(page, "revenue from enterprise customers this year");
  await expect(lastCard(page).getByTestId("understood")).toContainText("Segment is Corporate");
});

test("uploads a CSV and answers questions about it", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Upload data" }).first().click();
  const csv = "Order ID;Customer;City;Order Date;Amount\n1;Ayşe Yılmaz;İzmir;03.01.2025;1.250,50\n2;Mehmet Öztürk;Ankara;15.01.2025;980,00\n3;Ayşe Yılmaz;İzmir;02.02.2025;2.400,75\n";
  await page.getByTestId("upload-input").setInputFiles({ name: "orders.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  const dialog = page.getByRole("dialog", { name: "Use your own data" });
  await expect(dialog).toContainText("Loaded 1 table");
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await ask(page, "total amount by city");
  await expect(lastCard(page).getByTestId("answer")).toContainText("İzmir");
  await lastCard(page).getByRole("tab", { name: "Table" }).click();
  await expect(lastCard(page).getByRole("table")).toContainText("3,651.25");
});

test("explains files it can't read", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Upload data" }).first().click();
  await page.getByTestId("upload-input").setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n") });
  await expect(page.getByRole("dialog", { name: "Use your own data" }).getByRole("alert")).toContainText("is a PDF");
});

test("the command palette asks what you type", async ({ page, isMobile }) => {
  test.skip(isMobile, "Keyboard shortcut on desktop.");
  await open(page);
  await page.keyboard.press("ControlOrMeta+k");
  const box = page.getByRole("textbox", { name: "Search commands" });
  await box.fill("expenses by department");
  await box.press("Enter");
  await expect(lastCard(page).getByTestId("understood")).toContainText("Per department");
});

test("a shared link opens the same question", async ({ page }) => {
  await open(page, "#q=" + encodeURIComponent("revenue by segment"));
  await expect(lastCard(page).getByTestId("answer")).toContainText("Corporate has the highest revenue");
});

test("exports the result as CSV", async ({ page, isMobile }) => {
  test.skip(isMobile, "Downloads are checked on desktop browsers.");
  await open(page);
  await ask(page, "revenue by segment");
  const [download] = await Promise.all([page.waitForEvent("download"), lastCard(page).getByRole("button", { name: "CSV export" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^quarry-.*\.csv$/);
});

test("fits small screens without sideways scrolling", async ({ page }) => {
  await open(page);
  await ask(page, "monthly revenue this year");
  for (const v of [/Dashboard/, /^Data$/, /^SQL$/]) {
    await go(page, v);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
