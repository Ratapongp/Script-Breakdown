"use client";

import { useMemo } from "react";
import type { ScreenplayDoc } from "@/lib/scenes";
import { buildLocationReport } from "@/lib/scenes";
import { ReportSheet } from "../ReportSheet";
import { ReportToolbar } from "../ReportToolbar";

interface Props {
  doc: ScreenplayDoc;
}

export function LocationReport({ doc }: Props) {
  const rows = useMemo(() => buildLocationReport(doc), [doc]);
  function asText() {
    const header = ["Location", "Scenes", "Total"].join("\t");
    const body = rows.map((r) => [r.master, r.scenesText, r.totalScenes].join("\t"));
    return [header, ...body].join("\n");
  }
  return (
    <>
      <div className="no-print mb-4">
        <ReportToolbar
          filename={`${doc.title ?? "screenplay"} — Location Report`}
          getText={asText}
        />
      </div>
      <ReportSheet doc={doc} reportName="Location Report">
        <table className="report-table">
          <thead>
            <tr>
              <th style={{ width: "32%" }}>Location</th>
              <th>Scenes</th>
              <th className="num" style={{ width: "12%" }}>Total Scenes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.master}>
                <td>
                  <div className="font-medium">{r.master}</div>
                  {r.sublocations.length > 0 && (
                    <div className="text-xs text-neutral-500 mt-0.5">
                      {r.sublocations.join(" · ")}
                    </div>
                  )}
                </td>
                <td className="scenes">{r.scenesText}</td>
                <td className="num">{r.totalScenes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ReportSheet>
    </>
  );
}
