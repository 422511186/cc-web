import { expect, test } from "@playwright/test";
import { hostUrl, projectName, userPrompt } from "./helpers/fixture";

test("手机扫码配对链接后通过真实 WebRTC DataChannel 使用 P2PTransport 访问 Host", async ({ page, context }) => {
  await page.goto(`${hostUrl}/host`);

  await page.getByRole("button", { name: "生成二维码" }).click();
  const pairingUrlInput = page.locator("#pairing-url");
  await expect(pairingUrlInput).toHaveValue(/\/pair\/[A-Z0-9]+#signal=/);
  await expect(pairingUrlInput).not.toHaveValue(/p2p=/);
  await expect(page.getByAltText("配对二维码")).toBeVisible();
  await expect(page.getByLabel("链路拓扑")).toContainText("coderelay-e2e-host");
  const pairingUrl = await pairingUrlInput.inputValue();

  const phone = await context.newPage();
  await phone.goto(pairingUrl);

  await expect.poll(
    () => phone.evaluate(() => (window as unknown as { __coderelayTransportMode?: string }).__coderelayTransportMode),
    { timeout: 30_000 }
  ).toBe("p2p");
  await expect(phone.getByText("P2P 已连接")).toBeVisible();
  await expect(phone.getByText("协议：P2P")).toBeVisible();
  await expect(phone.getByText(projectName)).toBeVisible();
  await expect(phone.getByText(userPrompt)).toBeVisible();
});
