"use client";

import type { ScreenplayDoc } from "@/lib/scenes";
import { formatHeading } from "@/lib/scenes";
import { ReportSheet } from "../ReportSheet";
import { ReportToolbar } from "../ReportToolbar";

interface Props {
  doc: ScreenplayDoc;
}

export function SceneReport({ doc }: Props) {
  const rows = doc.scenes;
  function asText() {
    const header = ["Scene", "INT/EXT.Location - D/N", "Characters"].join("\t");
    const body = rows.map((s) =>
      [s.number, formatHeading(s), s.characters.join(", ")].join("\t"),
    );
    return [header, ...body].join("\n");
  }
  return (
    <>
      <div className="no-print mb-4">
        <ReportToolbar
          filename={`${doc.title ?? "screenplay"} — Scene Report`}
          getText={asText}
        />
      </div>
      <ReportSheet doc={doc} reportName="Scene Report">
        <table className="report-table">
          <thead>
            <tr>
              <th className="num">Scene</th>
              <th style={{ width: "55%" }}>INT/EXT. Location - D/N</th>
              <th>Characters</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.number}>
                <td className="num">{s.number}</td>
                <td>{formatHeading(s)}</td>
                <td>{s.characters.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ReportSheet>
    </>
  );
}
