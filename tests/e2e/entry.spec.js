import { expect, test } from "@playwright/test";

async function dismissIntro(page) {
  const intro = page.locator("#dither-intro");
  if (await intro.isVisible()) {
    await intro.click();
  }
  await expect(intro).toBeHidden();
}

test("the entry screen exposes the current creative workflow", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("./");
  await dismissIntro(page);

  await expect(page).toHaveTitle("DITHER / TECHNICAL SPECIMEN");
  await expect(page.getByRole("button", { name: "Upload" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reset" })).toBeDisabled();
  await expect(page.locator("#drop-zone")).toBeVisible();
  await expect(page.getByText("or click anywhere to browse")).toBeVisible();
  await expect(pageErrors).toEqual([]);
});

test("the entry screen loads without third-party runtime requests", async ({
  page,
}) => {
  const thirdPartyRequests = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== "http://127.0.0.1:4173") {
      thirdPartyRequests.push(request.url());
    }
  });

  await page.goto("./");
  await dismissIntro(page);

  expect(thirdPartyRequests).toEqual([]);
});
