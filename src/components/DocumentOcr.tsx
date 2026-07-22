import React, { useState, useRef } from "react";
import { 
  FileText, UploadCloud, Copy, Check, Download, 
  RotateCcw, Sparkles, AlertCircle, RefreshCw, File as FileIcon, FileDown
} from "lucide-react";

type FileKind = "image" | "pdf" | "docx" | "text";

const KIND_LABELS: Record<FileKind, string> = {
  image: "Image",
  pdf: "PDF Document",
  docx: "Word Document",
  text: "Text File",
};

const KIND_MIME: Record<Exclude<FileKind, "image">, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  text: "text/plain",
};

function detectFileKind(file: File): FileKind | null {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/.test(name)) return "image";
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  )
    return "docx";
  if (file.type === "text/plain" || name.endsWith(".txt")) return "text";
  return null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentOcr() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileData, setSelectedFileData] = useState<string | null>(null);
  const [selectedFileKind, setSelectedFileKind] = useState<FileKind | null>(null);
  const [extractedText, setExtractedText] = useState<string>("");
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [loadingStep, setLoadingStep] = useState<string>("");
  
  // UI States
  const [copied, setCopied] = useState<boolean>(false);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isExportingDocx, setIsExportingDocx] = useState<boolean>(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reassuring messages cycle
  const loadingSteps = [
    "Extracting text...",
  ];

  // Drag and drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const processFile = (file: File) => {
    const kind = detectFileKind(file);
    if (!kind) {
      setErrorMsg("Unsupported file type. Please upload an image (PNG/JPG/WebP), a PDF, or a Word (.docx) document.");
      return;
    }

    setErrorMsg(null);
    setSelectedFile(file);
    setSelectedFileKind(kind);

    const reader = new FileReader();
    reader.onload = (e) => {
      const rawResult = e.target?.result as string | undefined;
      if (!rawResult) return;
      const base64Part = rawResult.split(",")[1] ?? "";
      const mimeType = kind === "image" ? (file.type || "image/png") : KIND_MIME[kind];
      setSelectedFileData(`data:${mimeType};base64,${base64Part}`);
      setExtractedText("");
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // Run local text extraction (no API key required)
  const runOcrExtract = async () => {
    if (!selectedFileData) return;
    
    setIsExtracting(true);
    setErrorMsg(null);
    
    // Cycle through loading steps to provide a responsive loading sequence
    let stepIndex = 0;
    setLoadingStep(loadingSteps[stepIndex]);
    const stepInterval = setInterval(() => {
      stepIndex = (stepIndex + 1) % loadingSteps.length;
      setLoadingStep(loadingSteps[stepIndex]);
    }, 2500);

    try {
      const res = await fetch("/api/ocr-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          file: selectedFileData
        }),
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setExtractedText(data.text || "No text was detected in the document.");
      } else {
        setErrorMsg(data.error || "Failed to extract text. Check server configurations.");
      }
    } catch (e) {
      setErrorMsg("Network error connecting to the local extraction server.");
    } finally {
      clearInterval(stepInterval);
      setIsExtracting(false);
    }
  };

  // Copy text to clipboard
  const copyToClipboard = () => {
    navigator.clipboard.writeText(extractedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download extracted text as file
  const downloadTextFile = () => {
    const element = document.createElement("a");
    const file = new Blob([extractedText], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = "extracted-ocr-text.txt";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    URL.revokeObjectURL(element.href);
  };

  // Download extracted text as an editable Word document
  const downloadAsWord = async () => {
    if (!extractedText || isExportingDocx) return;
    setIsExportingDocx(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/export-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: extractedText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Failed to build the Word document.");
        return;
      }
      const byteChars = atob(data.docx_base64);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const element = document.createElement("a");
      element.href = URL.createObjectURL(blob);
      element.download = "extracted-text.docx";
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
      URL.revokeObjectURL(element.href);
    } catch (e) {
      setErrorMsg("Network error building the Word document.");
    } finally {
      setIsExportingDocx(false);
    }
  };

  const resetOcr = () => {
    setSelectedFile(null);
    setSelectedFileData(null);
    setSelectedFileKind(null);
    setExtractedText("");
    setErrorMsg(null);
  };

  return (
    <div className="space-y-6" id="document-ocr">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8" id="ocr-main-grid">
        {/* Left Pane: File Input & Configurations */}
        <div className="bg-paper-white p-6 rounded-xl border border-line shadow-subtle flex flex-col justify-between space-y-6 min-h-[600px]" id="ocr-input-pane">
          <div className="flex-1 flex flex-col space-y-4 min-h-0">
            <h2 className="text-subheading font-semibold text-ink tracking-tight flex items-center gap-2">
              <UploadCloud className="w-4 h-4 text-ink" />
              Document Upload & Selection
            </h2>

            {/* Drag & Drop File Container - Structured grid drafting board feel */}
            {!selectedFileData ? (
              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={triggerFileInput}
                className={`flex-1 border border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all ${
                  dragActive 
                    ? "border-ink bg-canvas" 
                    : "border-line hover:border-icon bg-canvas/50 hover:bg-canvas"
                }`}
                id="drag-drop-zone"
              >
                <div className="p-3 bg-paper-white rounded-full shadow-subtle border border-line" id="upload-icon-ring">
                  <UploadCloud className="w-5 h-5 text-subtext" />
                </div>
                <div className="text-center space-y-1" id="upload-instructions">
                  <p className="text-body-sm font-semibold text-ink">Drag & drop your document here</p>
                  <p className="text-caption text-subtext uppercase tracking-wider font-mono">Supports PNG, JPG, WebP, PDF, DOCX, TXT</p>
                </div>
                <button 
                  type="button"
                  className="mt-2 bg-paper-white border border-line text-subtext hover:text-ink text-body-sm font-medium py-1.5 px-3 rounded-lg shadow-sm transition-all cursor-pointer"
                  id="browse-files-btn"
                >
                  Browse Files
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,text/plain"
                  onChange={handleFileChange}
                  className="hidden"
                  id="hidden-file-input"
                />
              </div>
            ) : selectedFileKind === "image" ? (
              <div className="relative flex-1 border border-line rounded-xl p-3 bg-canvas flex items-center justify-center overflow-hidden shadow-inner" id="preview-pane">
                <img 
                  src={selectedFileData} 
                  alt="Scanned Preview" 
                  className="max-h-full rounded-lg object-contain shadow-sm bg-paper-white"
                  id="preview-image"
                />
                <button
                  onClick={resetOcr}
                  className="absolute top-4 right-4 p-2 bg-paper-white/90 hover:bg-paper-white text-ink rounded-lg shadow-sm border border-line transition-colors cursor-pointer"
                  title="Remove File"
                  id="remove-preview-btn"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative flex-1 border border-line rounded-xl p-3 bg-canvas flex flex-col items-center justify-center overflow-hidden shadow-inner gap-3" id="preview-pane">
                <div className="p-4 bg-paper-white rounded-full shadow-subtle border border-line" id="file-preview-icon-ring">
                  <FileIcon className="w-8 h-8 text-subtext" />
                </div>
                <div className="text-center px-6" id="file-preview-meta">
                  <p className="text-body-sm font-semibold text-ink break-all">{selectedFile?.name}</p>
                  <p className="text-caption text-subtext uppercase tracking-wider font-mono mt-1">
                    {selectedFileKind ? KIND_LABELS[selectedFileKind] : ""}
                    {selectedFile ? ` · ${formatFileSize(selectedFile.size)}` : ""}
                  </p>
                </div>
                <button
                  onClick={resetOcr}
                  className="absolute top-4 right-4 p-2 bg-paper-white/90 hover:bg-paper-white text-ink rounded-lg shadow-sm border border-line transition-colors cursor-pointer"
                  title="Remove File"
                  id="remove-preview-btn"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

          </div>

          {/* Action Trigger */}
          {selectedFileData && (
            <button
              onClick={runOcrExtract}
              disabled={isExtracting}
              className="w-full bg-ink hover:bg-ink/90 disabled:bg-line disabled:text-subtext text-paper-white font-medium text-body-sm py-3 px-4 rounded-lg flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
              id="run-ocr-extract-btn"
            >
              <Sparkles className="w-4 h-4 text-paper-white" />
              {isExtracting ? "Running Extraction..." : "Extract Text (Local Engine)"}
            </button>
          )}

          {errorMsg && (
            <div className="bg-paper-white border border-rose-200 p-3.5 rounded-xl flex items-center gap-2.5 text-body-sm text-rose-800" id="ocr-error-banner">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span className="font-medium">{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Right Pane: Extracted Output */}
        <div className="bg-paper-white p-6 rounded-xl border border-line shadow-subtle flex flex-col justify-between min-h-[600px]" id="ocr-output-pane">
          <div className="space-y-4 flex-1 flex flex-col h-full">
            <div className="flex items-center justify-between">
              <h2 className="text-subheading font-semibold text-ink tracking-tight flex items-center gap-2">
                <FileText className="w-4 h-4 text-ink" />
                Extracted Text Output
              </h2>
              {extractedText && (
                <div className="flex items-center gap-2" id="ocr-results-actions">
                  <button
                    onClick={copyToClipboard}
                    className="p-1.5 hover:bg-canvas text-subtext hover:text-ink rounded-lg border border-line bg-paper-white transition-colors flex items-center gap-1 text-caption font-semibold uppercase tracking-wider shadow-sm cursor-pointer"
                    title="Copy to Clipboard"
                    id="copy-text-btn"
                  >
                    {copied ? <Check className="w-3 h-3 text-ink" /> : <Copy className="w-3 h-3" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={downloadTextFile}
                    className="p-1.5 hover:bg-canvas text-subtext hover:text-ink rounded-lg border border-line bg-paper-white transition-colors flex items-center gap-1 text-caption font-semibold uppercase tracking-wider shadow-sm cursor-pointer"
                    title="Download as .txt"
                    id="download-text-btn"
                  >
                    <Download className="w-3 h-3" />
                    .txt
                  </button>
                  <button
                    onClick={downloadAsWord}
                    disabled={isExportingDocx}
                    className="p-1.5 hover:bg-canvas text-subtext hover:text-ink disabled:text-subtext/50 rounded-lg border border-line bg-paper-white transition-colors flex items-center gap-1 text-caption font-semibold uppercase tracking-wider shadow-sm cursor-pointer"
                    title="Download as Word (.docx)"
                    id="download-docx-btn"
                  >
                    <FileDown className="w-3 h-3" />
                    {isExportingDocx ? "Building..." : ".docx"}
                  </button>
                </div>
              )}
            </div>

            {/* Display Pane with states */}
            <div className="flex-1 min-h-[440px] rounded-xl border border-line bg-canvas p-4 flex flex-col" id="ocr-output-display">
              {isExtracting ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 py-12 text-center" id="ocr-loading-state">
                  <RefreshCw className="w-6 h-6 text-subtext animate-spin" />
                  <p className="text-body-sm font-semibold text-ink">{loadingStep}</p>
                  {/* <p className="text-caption text-subtext font-mono uppercase tracking-wider">Processing the image/document...</p> */}
                </div>
              ) : extractedText ? (
                <textarea
                  value={extractedText}
                  onChange={(e) => setExtractedText(e.target.value)}
                  className="flex-1 w-full bg-transparent border-0 resize-none font-mono text-body-sm leading-relaxed text-ink focus:outline-hidden min-h-[440px]"
                  id="extracted-text-area"
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center text-subtext py-12" id="ocr-empty-state">
                  <FileText className="w-6 h-6 text-icon stroke-[1.5]" />
                  <p className="text-body-sm font-medium text-ink">No text extracted yet.</p>
                  <p className="text-caption text-subtext uppercase tracking-wider font-mono">Upload a document to start extraction.</p>
                </div>
              )}
            </div>
          </div>
          
          {extractedText && !isExtracting && (
            <div className="border-t border-line pt-4 flex justify-between items-center text-caption text-subtext font-mono uppercase tracking-wider" id="extracted-text-metadata">
              <span>Lines: {extractedText.split("\n").length}</span>
              <span>Words: {extractedText.split(/\s+/).filter(Boolean).length}</span>
              <span>Characters: {extractedText.length}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
