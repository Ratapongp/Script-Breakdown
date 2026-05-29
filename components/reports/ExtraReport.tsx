"use client";

import { useMemo } from "react";
import type { ScreenplayDoc } from "@/lib/scenes";
import { buildExtraReport } from "@/lib/scenes";
import { ReportSheet } from "../ReportSheet";
import { ReportToolbar } from "../ReportToolbar";

interface Props {
  doc: ScreenplayDoc;
}

export function ExtraReport({ doc }: Props) {
  const rows = useMemo(() => buildExtraReport(doc), [doc]);
  function asText() {
    const header = ["Scene", "Location", "Extra Description"].join("\t");
    const body = rows.map((r) => [r.scene, r.location, r.description].join("\t"));
    return [header, ...body].join("\n");
  }
  return (
    <>
      <div className="no-print mb-4">
        <ReportToolbar
          filename={`${doc.title ?? "screenplay"} — Extra Cast Report`}
          getText={asText}
        />
      </div>
      <ReportSheet doc={doc} reportName="Extra Cast Report">
        {rows.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No EXTRA entries found in this screenplay. (Lines like
            <code className="mx-1 rounded bg-neutral-100 px-1.5 py-0.5">(char1, char2, EXTRA market vendors)</code>
            are detected automatically.)
          </p>
        ) : (
          <table className="report-table">
            <thead>
              <tr>
                <th className="num" style={{ width: "8%" }}>Scene</th>
                <th style={{ width: "32%" }}>Location</th>
                <th>Extra Description</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={`${r.scene}-${idx}`}>
                  <td className="num">{r.scene}</td>
                  <td>{r.location}</td>
                  <td>{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportSheet>
    </>
  );
}
