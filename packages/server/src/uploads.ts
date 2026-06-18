import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import type { UploadResponse } from "@cc-web/shared";

/** 创建上传路由,文件存到 destDir,引用是随机文件名(保留扩展名)。 */
export function createUploadRouter(destDir: string): Router {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destDir),
    filename: (_req, file, cb) =>
      cb(null, `${randomUUID()}${extname(file.originalname)}`),
  });
  const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

  const router = Router();
  router.post("/", upload.single("file"), (req, res) => {
    const file = (req as { file?: { filename: string; originalname: string } })
      .file;
    if (!file) {
      res.status(400).json({ error: "no file" });
      return;
    }
    const body: UploadResponse = {
      ref: file.filename,
      filename: file.originalname,
    };
    res.json(body);
  });
  return router;
}
