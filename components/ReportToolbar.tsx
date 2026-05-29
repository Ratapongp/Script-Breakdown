"use client";

import { useState } from "react";

interface Props {
  filename: string;
  getText: () => string;
}

export function ReportToolbar({ filename, getText }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = getText();
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  function handlePrint() {
    window.print();
  }

  function handleExportPdf() {
    // Browser print-to-PDF preserves Thai fonts perfectly; instruct user.
    window.print();
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <button
        onClick={handleCopy}
        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
      >
        {copied ? "Copied!" : "Copy Text"}
      </button>
      <button
        onClick={handleExportPdf}
        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
        title="Opens the browser print dialog — choose 'Save as PDF' as destination."
      >
        Export PDF
      </button>
      <button
        onClick={handlePrint}
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
      >
        Print
      </button>
      <span className="ml-auto text-xs text-neutral-500">{filename}</span>
    </div>
  );
}
