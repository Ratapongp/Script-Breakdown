"use client";

import { useMemo } from "react";
import type { ScreenplayDoc } from "@/lib/scenes";
import { buildCharacterReport } from "@/lib/scenes";
import { ReportSheet } from "../ReportSheet";
import { ReportToolbar } from "../ReportToolbar";

interface Props {
  doc: ScreenplayDoc;
}

export function CharacterReport({ doc }: Props) {
  const rows = useMemo(() => buildCharacterReport(doc), [doc]);
  function asText() {
    const header = ["Rank", "Character", "Scenes", "Total"].join("\t");
    const body = rows.map((r) => [r.rank, r.name, r.scenesText, r.totalScenes].join("\t"));
    return [header, ...body].join("\n");
  }
  return (
    <>
      <div className="no-print mb-4">
        <ReportToolbar
          filename={`${doc.title ?? "screenplay"} — Character Report`}
          getText={asText}
        />
      </div>
      <ReportSheet doc={doc} reportName="Character Report">
        <table className="report-table">
          <thead>
            <tr>
              <th className="num">Rank</th>
              <th style={{ width: "22%" }}>Character</th>
              <th>Scenes</th>
              <th className="num" style={{ width: "12%" }}>Total Scenes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="num">{r.rank}</td>
                <td>{r.name}</td>
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
