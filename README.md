# OCR Document Extractor

Extract text from scanned documents, receipts, printed pages, and photos — locally and offline, with reading order reconstructed geometrically rather than assumed.

<!-- 🖼️ Add a screenshot or 15-second GIF here of dragging a file in and getting text out.
     This is the single highest-impact thing you can add to this README. -->

## Why this isn't just an EasyOCR wrapper

Most OCR demos hand you EasyOCR's raw word detections in whatever order the model found them — which is *not* reading order, especially on multi-column layouts or slightly skewed scans. This project reconstructs the actual reading order geometrically:

- **Line clustering** — groups individual word detections into lines using estimated global page skew, per-detection angle reliability, and distance thresholds (`reading_order.py`)
- **Skew estimation** — via angle-projection analysis across all detections, so rotated/skewed scans still read correctly
- **Redaction detection** — separately scans for solid near-black rectangular regions (redaction marks) and folds them into the reconstructed layout
- **Smart PDF handling** — reads the embedded text layer directly when present (fast, exact, zero OCR error); only rasterizes and OCRs pages that are actually scanned images

## Features

- Multi-format: images (PNG/JPG/WebP), PDFs (text-layer or scanned), and `.docx` files
- Drag-and-drop upload
- Copy to clipboard, download as `.txt`, or export as a formatted `.docx`
- Fully local & offline after the one-time EasyOCR model download — no data leaves the machine
- Automatic image preprocessing (upscaling small images via Lanczos resampling before OCR)

## Tech stack
- Frontend : React 19, TypeScript, Vite, Tailwind CSS v4 
- Server : Express, sharp (image preprocessing) 
- OCR backend : Python, EasyOCR, PyMuPDF (`fitz`), python-docx 

## Getting started

```bash
# install frontend/server dependencies
npm install

# install the Python OCR backend dependencies
pip install -r requirements.txt

# run everything (Express spawns the Python backend automatically)
npm run dev
```

Open `http://localhost:3000`. The first run downloads EasyOCR's model weights (~65MB), which are then cached locally.

## Limitations

- Currently English-only (`easyocr.Reader(["en"])`)
- PDFs are capped at 25 pages per request
- Runs on CPU by default (no GPU inference)
