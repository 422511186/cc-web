import { describe, expect, it } from "vitest";
import { createHostManagementPage } from "./p2pManagementPage.js";

describe("Host management page", () => {
  it("uses an operations-console layout with pairing as the primary workflow", () => {
    const html = createHostManagementPage();

    expect(html).toContain('class="status-strip"');
    expect(html).toContain('id="signal-card"');
    expect(html).toContain('id="peer-card"');
    expect(html).toContain('id="turn-card"');
    expect(html).toContain('class="primary-panel" aria-label="添加设备"');
    expect(html).toContain('id="copy-pairing"');
    expect(html).toContain('class="secondary-grid"');
  });

  it("renders devices as a full-width list with long identifiers constrained", () => {
    const html = createHostManagementPage();

    expect(html).toContain('class="devices-list"');
    expect(html).toContain('class="device-card"');
    expect(html).toContain('class="device-id"');
    expect(html).toContain("overflow-wrap: anywhere");
    expect(html).toContain("min-width: 0");
    expect(html).not.toContain("<table>");
  });

  it("shows topology as readable fields and keeps raw JSON in a debug disclosure", () => {
    const html = createHostManagementPage();

    expect(html).toContain('id="topology-cards"');
    expect(html).toContain("信令服务");
    expect(html).toContain("当前连接");
    expect(html).toContain("<details");
    expect(html).toContain('id="topology-json"');
    expect(html).toContain("调试详情");
  });

  it("uses documentation-reserved addresses in placeholders", () => {
    const html = createHostManagementPage();

    expect(html).toContain("192.0.2.20");
    expect(html).not.toMatch(/\b172\.(1[6-9]|2\d|3[0-1])\./);
  });
});
