import express from "express";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { createServer as createViteServer } from "vite";
import sharp from "sharp";

const PYTHON_OCR_PORT = 5001;
const PYTHON_EXTRACT_URL = `http://127.0.0.1:${PYTHON_OCR_PORT}/extract`;
const PYTHON_BUILD_DOCX_URL = `http://127.0.0.1:${PYTHON_OCR_PORT}/build-docx`;
const PYTHON_HEALTH_URL = `http://127.0.0.1:${PYTHON_OCR_PORT}/health`;

const DIRECT_PASS_THROUGH_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "text/plain",
]);

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function waitForPythonBackend(maxWaitMs: number): Promise<void> {
  const start = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - start < maxWaitMs) {
    try {
      await fetch(PYTHON_HEALTH_URL);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(
    "The local OCR backend isn't responding. Make sure its Python dependencies are installed " +
      `(pip install -r requirements.txt) and check the server logs. Last error: ${lastErr}`
  );
}

async function preprocessImage(dataUri: string): Promise<string> {
  const match = dataUri.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid image format. Expected base64 Data URI.");
  }
  const inputBuffer = Buffer.from(match[1], "base64");

  const image = sharp(inputBuffer);
  const meta = await image.metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  const longestSide = Math.max(width, height);

  if (longestSide > 0 && longestSide < 1600) {
    const scale = Math.min(2, 1600 / longestSide);
    image.resize({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      kernel: "lanczos3",
    });
  }

  const outBuffer = await image.png().toBuffer();
  return `data:image/png;base64,${outBuffer.toString("base64")}`;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  let pythonProcess: ChildProcess;
  try {
    pythonProcess = spawn("python3", ["easyocr_server.py"], {
      stdio: "inherit",
      detached: false,
    });
    pythonProcess.on("error", (err) => {
      console.error("Failed to start local OCR backend process:", err);
    });
    pythonProcess.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(
          `Local OCR backend exited unexpectedly (code ${code}). ` +
            `Check that its dependencies are installed: pip install -r requirements.txt`
        );
      }
    });
  } catch (err) {
    console.error("Could not spawn the local OCR backend:", err);
  }
  const backendReady = waitForPythonBackend(180_000).catch((err) => {
    console.error(err.message);
    return err as Error;
  });
  app.use(express.json({ limit: "30mb" }));

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    next();
  });

  app.post("/api/ocr-extract", async (req, res) => {
    try {
      const { file } = req.body;
      if (!file) {
        return res.status(400).json({ error: "Missing file data." });
      }
      const mimeMatch =
        typeof file === "string" ? file.match(/^data:([a-zA-Z0-9.+/-]+);base64,(.+)$/) : null;
      if (!mimeMatch) {
        return res.status(400).json({ error: "Invalid file format. Expected base64 Data URI." });
      }
      const mimeType = mimeMatch[1];

      const readiness = await backendReady;
      if (readiness instanceof Error) {
        return res.status(503).json({ error: readiness.message });
      }

      let payload: string;
      if (mimeType.startsWith("image/")) {
        console.log("Running local extraction on an image...");
        payload = await preprocessImage(file);
      } else if (DIRECT_PASS_THROUGH_TYPES.has(mimeType)) {
        console.log(`Running local extraction on ${mimeType}...`);
        payload = file;
      } else {
        return res.status(400).json({
          error:
            `Unsupported file type: ${mimeType}. Supported: images (PNG/JPG/WebP), PDF, and Word (.docx) documents.`,
        });
      }

      const extractResponse = await withTimeout(
        fetch(PYTHON_EXTRACT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file: payload }),
        }),
        180_000,
        "The local extraction backend timed out processing this file. Large multi-page PDFs can take a while — try again, or split the file if this keeps happening."
      );

      const data = await extractResponse.json();
      if (!extractResponse.ok) {
        return res.status(extractResponse.status).json(data);
      }

      res.json({ text: data.text, meta: data.meta ?? null });
    } catch (err: any) {
      console.error("Local extraction failed:", err);
      res.status(500).json({
        error: err.message || "Failed to extract text using the local engine."
      });
    }
  });

  app.post("/api/export-docx", async (req, res) => {
    try {
      const { text } = req.body;
      if (typeof text !== "string" || !text.trim()) {
        return res.status(400).json({ error: "No text provided to export." });
      }

      const readiness = await backendReady;
      if (readiness instanceof Error) {
        return res.status(503).json({ error: readiness.message });
      }

      const buildResponse = await withTimeout(
        fetch(PYTHON_BUILD_DOCX_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        }),
        30_000,
        "Timed out building the Word document."
      );

      const data = await buildResponse.json();
      if (!buildResponse.ok) {
        return res.status(buildResponse.status).json(data);
      }

      res.json({ docx_base64: data.docx_base64 });
    } catch (err: any) {
      console.error("Word export failed:", err);
      res.status(500).json({ error: err.message || "Failed to build the Word document." });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Full-Stack Express server listening on http://localhost:${PORT}`);
  });
}

startServer();
