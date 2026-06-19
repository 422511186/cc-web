import { expect, test } from "@playwright/test";
import { authToken, projectName, userPrompt } from "./helpers/fixture";

test("手机扫码配对链接后通过真实 WebRTC DataChannel 使用 P2PTransport 访问 Host", async ({ page, context }) => {
  await page.goto("/");

  await page.getByLabel("Access Token").fill(authToken);
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page.getByText(projectName)).toBeVisible();

  await page.getByRole("button", { name: "添加设备" }).click();
  const pairingUrlInput = page.getByLabel("配对链接");
  await expect(pairingUrlInput).toHaveValue(/p2p=/);
  await expect(page.getByAltText("配对二维码")).toBeVisible();
  const pairingUrl = await pairingUrlInput.inputValue();

  const phone = await context.newPage();
  await phone.goto(pairingUrl);
  await phone.getByLabel("Access Token").fill(authToken);
  await phone.getByRole("button", { name: "Login" }).click();

  await expect.poll(
    () => phone.evaluate(() => (window as unknown as { __coderelayTransportMode?: string }).__coderelayTransportMode),
    { timeout: 30_000 }
  ).toBe("p2p");
  await expect(phone.getByText("P2P 已连接")).toBeVisible();
  await expect(phone.getByText(projectName)).toBeVisible();
  await expect(phone.getByText(userPrompt)).toBeVisible();
});
