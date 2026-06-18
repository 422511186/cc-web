import { expect, test } from "@playwright/test";
import { assistantAnswer, authToken, projectName, userPrompt } from "./helpers/fixture";

test("HTTP 模式可以通过真实 Web 和 Host 浏览历史会话", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "CC Web Login" })).toBeVisible();
  await page.getByLabel("Access Token").fill(authToken);
  await page.getByRole("button", { name: "Login" }).click();

  await expect(page.getByText(projectName)).toBeVisible();
  await expect(page.getByText(userPrompt)).toBeVisible();

  await page.getByText(userPrompt).first().click();

  await expect(page.getByText(assistantAnswer)).toBeVisible();
});
