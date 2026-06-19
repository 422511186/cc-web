import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createUploadRouter } from "./uploads.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cc-web-up-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function app() {
  const a = express();
  a.use("/api/uploads", createUploadRouter(dir));
  return a;
}

describe("upload router", () => {
  it("stores an uploaded file and returns a ref", async () => {
    const res = await request(app())
      .post("/api/uploads")
      .attach("file", Buffer.from("hello"), "note.txt");
    expect(res.status).toBe(200);
    expect(res.body.filename).toBe("note.txt");
    expect(typeof res.body.ref).toBe("string");
    expect(existsSync(join(dir, res.body.ref))).toBe(true);
  });

  it("keeps the upload endpoint compatible for existing non-image attachment refs", async () => {
    const res = await request(app())
      .post("/api/uploads")
      .attach("file", Buffer.from("hello"), "note.txt");

    expect(res.status).toBe(200);
    expect(res.body.filename).toBe("note.txt");
  });

  it("rejects a request with no file", async () => {
    const res = await request(app()).post("/api/uploads");
    expect(res.status).toBe(400);
  });
});
