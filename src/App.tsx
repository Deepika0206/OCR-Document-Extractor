import React from "react";
import { ScanText } from "lucide-react";
import DocumentOcr from "./components/DocumentOcr";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-canvas text-ink font-sans selection:bg-ink selection:text-paper-white" id="app-root">
      {/* Precision Header with 1px Bottom Border */}
      <header className="bg-paper-white border-b border-line sticky top-0 z-40" id="main-header">
        <div className="max-w-(--page-max-width) mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3" id="header-logo-section">
            <div className="bg-ink text-paper-white p-2 rounded-lg" id="logo-icon-box">
              <ScanText className="w-4 h-4 text-paper-white" />
            </div>
            <div>
              <h1 className="text-body-sm font-semibold tracking-tight text-ink">
                OCR Document Extractor
              </h1>
              <p className="text-caption text-subtext font-mono uppercase tracking-wider"></p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Layout */}
      <main className="flex-1 max-w-(--page-max-width) mx-auto px-6 py-12 space-y-8 w-full" id="main-content">
        {/* Title & Introduction Panel */}
        <div className="bg-paper-white p-6 rounded-xl border border-line shadow-subtle space-y-1.5" id="intro-panel">
          <h2 className="text-heading-lg font-semibold tracking-[-1.28px] text-ink">
            Optical Character Recognition
          </h2>
          <p className="text-body-sm text-subtext max-w-3xl leading-relaxed">
            Extract text from scanned documents, receipts, printed pages, and photos of signage.
          </p>
        </div>

        <DocumentOcr />
      </main>

      {/* Footer
      <footer className="border-t border-line bg-paper-white py-8 text-center" id="main-footer">
        <div className="max-w-(--page-max-width) mx-auto px-6 flex items-center justify-center gap-4 text-caption text-subtext font-mono uppercase tracking-wider">
          <span>OCR</span>
        </div>
      </footer> */}
    </div>
  );
}
