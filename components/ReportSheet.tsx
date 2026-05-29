"use client";

import { ReactNode } from "react";
import type { ScreenplayDoc } from "@/lib/scenes";

interface Props {
  doc: ScreenplayDoc;
  reportName: string;
  children: ReactNode;
}

export function ReportSheet({ doc, reportName, children }: Props) {
  const generated = new Date().toLocaleString();
  return (
    <div className="report-sheet bg-white shadow-sm border border-neutral-200 rounded-lg p-8 md:p-10">
      <header className="border-b border-neutral-200 pb-4 mb-5">
        <h1 className="report-title">{reportName}</h1>
        <div className="report-meta">
          {doc.title && (
            <span>
              <strong>Project:</strong> {doc.title}
            </span>
          )}
          {doc.draftDate && (
            <span>
              <strong>Draft:</strong> {doc.draftDate}
            </span>
          )}
          <span>
            <strong>Total Scenes:</strong> {doc.totalScenes}
          </span>
          <span>
            <strong>Generated:</strong> {generated}
          </span>
        </div>
      </header>
      {children}
    </div>
  );
}
