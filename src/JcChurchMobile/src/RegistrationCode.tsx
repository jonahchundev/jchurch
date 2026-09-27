import { useState } from "react";
import { Platform, View } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { File } from "expo-file-system";
import { SvgXml } from "react-native-svg";
import bwipjs from "bwip-js/generic";
import { message } from "./api/client";
import { Button, Heading, IconButton, Label, Notice, Sheet, styles } from "./ui";

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export function RegistrationCode({ title, subtitle, url, onClose }: {
  title: string;
  subtitle?: string;
  url: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  let svg: string;
  try {
    svg = bwipjs.toSVG({ bcid: "qrcode", text: url, scale: 3, padding: 12, backgroundcolor: "FFFFFF" });
  } catch {
    return (
      <Sheet title="Registration code" onClose={onClose}>
        <Notice error>Unable to render this code.</Notice>
      </Sheet>
    );
  }
  async function output(share: boolean) {
    setBusy(true);
    setError("");
    try {
      const html = `<html><head><meta charset="utf-8"><style>@page{size:portrait;margin:18mm}body{font-family:sans-serif;color:#000;background:#fff;text-align:center}svg{max-width:100%;height:auto;max-height:320px}p{overflow-wrap:anywhere}</style></head><body><h1>${escape(title)}</h1>${subtitle ? `<h2>${escape(subtitle)}</h2>` : ""}${svg}<p>${escape(url)}</p></body></html>`;
      if (share && Platform.OS !== "web") {
        if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device.");
        const file = await Print.printToFileAsync({ html });
        try {
          await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
        } finally {
          new File(file.uri).delete();
        }
      } else await Print.printAsync({ html });
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="Registration code" onClose={onClose}>
      <View style={styles.stack}>
        <Heading>{title}</Heading>
        {!!subtitle && <Label muted>{subtitle}</Label>}
        <View style={{ backgroundColor: "white", alignSelf: "flex-start" }}>
          <View accessibilityLabel="Registration QR code" accessible>
            <SvgXml xml={svg} width={240} height={240} />
          </View>
        </View>
        <Label>{url}</Label>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <IconButton icon="print-outline" label="Print registration code" disabled={busy} onPress={() => void output(false)} />
          {Platform.OS !== "web" && (
            <IconButton icon="share-outline" label="Share registration link" disabled={busy} onPress={() => void output(true)} />
          )}
        </View>
        {!!error && <Notice error>{error}</Notice>}
        <Button secondary onPress={onClose}>Close</Button>
      </View>
    </Sheet>
  );
}
