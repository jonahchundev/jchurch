import { createElement, useRef, useState, type ChangeEvent } from "react";
import { Platform, View } from "react-native";
import Papa from "papaparse";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { api, churchPath } from "../api/hooks";
import { message } from "../api/client";
import type { MemberImportResult } from "../api/types";
import { splitImportRow } from "../csvSchema";
import { Button, Heading, Label, Notice, Row, Sheet, styles } from "../ui";

type Busy = "" | "export" | "template" | "import";

export default function MembersImportExport({
  churchId,
  onClose,
  onImported,
}: {
  churchId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<MemberImportResult | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  async function download(path: string, filename: string, kind: Busy) {
    setBusy(kind);
    setError("");
    try {
      const text = await api.text(churchPath(churchId, path));
      if (Platform.OS === "web") {
        const blob = new Blob([text], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      } else {
        const file = new File(Paths.cache, filename);
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
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy("");
    }
  }

  async function importText(text: string) {
    setBusy("import");
    setError("");
    setResult(null);
    try {
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
      });
      if (parsed.errors.length > 0) throw new Error(parsed.errors[0]?.message);
      const rows = parsed.data.map(splitImportRow);
      const outcome = await api.importMembers(churchId, rows);
      setResult(outcome);
      if (outcome.failed === 0) onImported();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy("");
    }
  }

  async function pickAndImport() {
    if (Platform.OS === "web") {
      fileInput.current?.click();
      return;
    }
    setError("");
    try {
      const picked = await File.pickFileAsync({
        mimeTypes: ["text/csv", "text/comma-separated-values", "text/plain"],
      });
      if (picked.canceled) return;
      await importText(await picked.result.text());
    } catch (failure) {
      setError(message(failure));
    }
  }

  return (
    <Sheet title="Import / export members" onClose={onClose} busy={busy !== ""}>
      <View style={styles.stack}>
        <Heading>Export</Heading>
        <Button
          secondary
          icon="download-outline"
          busy={busy === "export"}
          disabled={busy !== ""}
          onPress={() => void download("members/export", "members.csv", "export")}
        >
          Download all members (CSV)
        </Button>
        <Button
          secondary
          icon="document-outline"
          busy={busy === "template"}
          disabled={busy !== ""}
          onPress={() =>
            void download("members/import-template", "members-template.csv", "template")
          }
        >
          Download import template (CSV)
        </Button>
        <Heading>Import</Heading>
        <Label muted small>
          Groups are colon-separated group names (use &quot;Parent / Child&quot; for
          subgroups). A row with an Id that matches an existing member updates it;
          otherwise a new member is created.
        </Label>
        <Button
          icon="cloud-upload-outline"
          busy={busy === "import"}
          disabled={busy !== ""}
          onPress={() => void pickAndImport()}
        >
          Upload CSV to import
        </Button>
        {Platform.OS === "web" &&
          createElement("input", {
            ref: fileInput,
            type: "file",
            accept: ".csv,text/csv",
            style: { display: "none" },
            onChange: (event: ChangeEvent<HTMLInputElement>) => {
              const selected = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (selected) void selected.text().then(importText);
            },
          })}
        {!!error && <Notice error>{error}</Notice>}
        {result && (
          <View style={styles.stack}>
            <Notice error={result.failed > 0}>
              {result.created} created, {result.updated} updated, {result.failed}{" "}
              failed.
            </Notice>
            {result.results
              .filter((row) => row.action === "error")
              .map((row) => (
                <Row
                  key={row.row}
                  title={`Row ${row.row}`}
                  subtitle={row.errors?.join(" ") ?? "Unknown error."}
                  icon="alert-circle-outline"
                />
              ))}
          </View>
        )}
      </View>
    </Sheet>
  );
}
