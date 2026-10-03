import { useState } from "react";
import { Platform, View } from "react-native";
import Papa from "papaparse";
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { message } from "../api/client";
import { Button, IconButton, Notice, Sheet, styles } from "../ui";

// A tabular report ready for export: stable filename base, display title, header row, data rows.
export type ExportTable = {
  filename: string;
  title: string;
  headers: string[];
  rows: (string | number)[][];
};

// Optional rich PDF sections matching the on-screen report: headline stats and a bar chart.
// The CSV always receives `table` only.
export type ExportExtras = {
  stats?: { label: string; value: string }[];
  bars?: { label: string; value: number }[];
  barsTitle?: string;
};

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

// CSV export follows the MembersImportExport download pattern: Blob download on web,
// cache-file + native share sheet elsewhere.
async function shareCsv(table: ExportTable) {
  const text = Papa.unparse({ fields: table.headers, data: table.rows });
  if (Platform.OS === "web") {
    const blob = new Blob([text], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${table.filename}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, `${table.filename}.csv`);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  try {
    if (!(await Sharing.isAvailableAsync()))
      throw new Error("Sharing is not available on this device.");
    await Sharing.shareAsync(file.uri, { mimeType: "text/csv" });
  } finally {
    file.delete();
  }
}

// PDF export follows the ScanCode pattern: render an HTML report (stat cards + CSS bar
// chart + table), print dialog on web, print-to-file + share sheet on native.
// expo-print's web printAsync ignores the HTML and prints the whole app page
// (window.print()), so on web we render the report HTML into a hidden iframe and print
// just that frame. Native uses printToFileAsync, which honors the HTML.
function printHtmlOnWeb(html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);
  const frame = iframe.contentWindow;
  if (!frame) {
    iframe.remove();
    throw new Error("Unable to open the print view.");
  }
  frame.document.open();
  frame.document.write(html);
  frame.document.close();
  const cleanup = () => iframe.remove();
  // Remove the frame after printing (and as a fallback if the event never fires).
  frame.addEventListener("afterprint", cleanup);
  frame.focus();
  frame.print();
  setTimeout(cleanup, 60_000);
}

async function sharePdf(table: ExportTable, extras: ExportExtras) {
  const stats = extras.stats?.length
    ? `<div class="stats">${extras.stats
        .map(
          (stat) =>
            `<div class="stat"><div class="value">${escapeHtml(stat.value)}</div><div class="label">${escapeHtml(stat.label)}</div></div>`,
        )
        .join("")}</div>`
    : "";
  const max = Math.max(0, ...(extras.bars ?? []).map((bar) => bar.value));
  // Bars use inline SVG rects, not CSS background-color: browsers omit backgrounds in
  // print unless "Background graphics" is enabled, but SVG vector fills always print.
  const bars = extras.bars?.length
    ? `<h2>${escapeHtml(extras.barsTitle ?? "Breakdown")}</h2>${extras.bars
        .map((bar) => {
          const percent = max > 0 ? Math.max((bar.value / max) * 100, 2) : 0;
          const svg =
            `<svg class="bar-svg" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true">` +
            `<rect x="0" y="0" width="100" height="14" rx="3" fill="#E8F2EE"/>` +
            `<rect x="0" y="0" width="${percent}" height="14" rx="3" fill="#146B59"/>` +
            `</svg>`;
          return `<div class="bar-row"><div class="bar-label">${escapeHtml(bar.label)}</div><div class="bar-track">${svg}</div><div class="bar-value">${bar.value}</div></div>`;
        })
        .join("")}`
    : "";
  const head = table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const body = table.rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`,
    )
    .join("");
  const html = `<html><head><meta charset="utf-8"><style>
@page{margin:16mm}
body{font-family:sans-serif;color:#202C2A}
h1{font-size:20px;margin:0 0 14px}h2{font-size:15px;margin:18px 0 10px}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:6px}
.stat{border:1px solid #DCE5E0;border-radius:8px;padding:10px 14px;min-width:110px}
.stat .value{font-size:20px;font-weight:700}
.stat .label{font-size:11px;color:#5C6D68}
.bar-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.bar-label{width:130px;font-size:12px;color:#5C6D68;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-track{flex:1}
.bar-svg{display:block;width:100%;height:14px}
.bar-value{width:40px;text-align:right;font-size:12px;font-weight:600}
table{border-collapse:collapse;width:100%;margin-top:14px}
th,td{border:1px solid #DCE5E0;padding:6px 8px;text-align:left;font-size:13px}
</style></head><body><h1>${escapeHtml(table.title)}</h1>${stats}${bars}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
  if (Platform.OS !== "web") {
    if (!(await Sharing.isAvailableAsync()))
      throw new Error("Sharing is not available on this device.");
    const file = await Print.printToFileAsync({ html });
    try {
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
      });
    } finally {
      new File(file.uri).delete();
    }
  } else printHtmlOnWeb(html);
}

export function ExportMenu({
  table,
  extras = {},
  disabled = false,
}: {
  table: ExportTable;
  extras?: ExportExtras;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"" | "csv" | "pdf">("");
  const [error, setError] = useState("");
  async function run(kind: "csv" | "pdf") {
    setBusy(kind);
    setError("");
    try {
      await (kind === "csv" ? shareCsv(table) : sharePdf(table, extras));
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <IconButton
        icon="download-outline"
        label="Export report"
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      {open && (
        <Sheet title="Export report" onClose={() => setOpen(false)} busy={!!busy}>
          <View style={styles.stack}>
            <Button
              icon="document-text-outline"
              busy={busy === "csv"}
              disabled={!!busy}
              onPress={() => void run("csv")}
            >
              Download CSV
            </Button>
            <Button
              secondary
              icon="print-outline"
              busy={busy === "pdf"}
              disabled={!!busy}
              onPress={() => void run("pdf")}
            >
              PDF / Print
            </Button>
            {!!error && <Notice error>{error}</Notice>}
          </View>
        </Sheet>
      )}
    </>
  );
}
