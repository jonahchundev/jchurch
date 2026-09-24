import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { File } from "expo-file-system";
import { SvgXml } from "react-native-svg";
import bwipjs from "bwip-js/generic";
import { normalizeScanCode } from "./domain";
import { Button, Heading, IconButton, Label, Notice, styles, Toggle } from "./ui";
import { message } from "./api/client";

export function generateScanCode() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = Crypto.getRandomBytes(26);
  return "JC" + Array.from(bytes, value => alphabet[value & 31]).join("");
}

export function useScanActive() {
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", value => setForeground(value === "active"));
    return () => subscription.remove();
  }, []);
  return focused && foreground;
}

export function ScanInput({ onScan, disabled = false, format = "qr" }: {
  onScan: (code: string) => void;
  disabled?: boolean;
  format?: "qr" | "code128";
}) {
  const active = useScanActive();
  const [permission, requestPermission] = useCameraPermissions();
  const [camera, setCamera] = useState(false);
  const [facing, setFacing] = useState<"front" | "back">("back");
  const [torch, setTorch] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const previous = useRef({ code: "", at: 0 });
  const field = useRef<TextInput>(null);
  useEffect(() => {
    if (!active) {
      previous.current = { code: "", at: 0 };
      setInput("");
      setTorch(false);
    }
  }, [active]);
  function accept(raw: string) {
    if (disabled || !active) return;
    try {
      const code = normalizeScanCode(raw);
      if (code === previous.current.code && Date.now() - previous.current.at < 2500) return;
      previous.current = { code, at: Date.now() };
      setError("");
      setInput("");
      onScan(code);
    } catch (failure) { setError(message(failure)); }
  }
  return (
    <View style={styles.stack}>
      <Label>Scan or enter code</Label>
      <TextInput
        ref={field}
        accessibilityLabel="Scan or enter code"
        value={input}
        onChangeText={setInput}
        onSubmitEditing={() => accept(input)}
        submitBehavior="submit"
        editable={!disabled && active}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={128}
        style={styles.input}
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <IconButton icon="keypad-outline" label="Focus scanner input" onPress={() => field.current?.focus()} disabled={disabled} />
        {Platform.OS !== "web" && <IconButton icon="camera-outline" label={camera ? "Stop camera" : "Start camera"} disabled={disabled} onPress={async () => {
          if (camera) { setCamera(false); return; }
          try {
            const result = permission?.granted ? permission : await requestPermission();
            if (result.granted) { setError(""); setCamera(true); }
            else setError("Camera access is denied. You can still enter a code.");
          } catch (failure) { setError(message(failure)); }
        }} />}
      </View>
      {permission && !permission.granted && !permission.canAskAgain && Platform.OS !== "web" &&
        <Button secondary onPress={() => void Linking.openSettings()}>Open camera settings</Button>}
      {camera && permission?.granted && active && !disabled && (
        <>
          <CameraView
            style={{ width: "100%", aspectRatio: 4 / 3, maxHeight: 340 }}
            facing={facing}
            enableTorch={torch && facing === "back"}
            barcodeScannerSettings={{ barcodeTypes: [format] }}
            onBarcodeScanned={result => accept(result.data)}
            onMountError={() => { setCamera(false); setError("Camera unavailable. Enter a code or try again."); }}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <IconButton icon="camera-reverse-outline" label="Switch camera" onPress={() => setFacing(value => value === "back" ? "front" : "back")} />
            <Toggle label="Torch" value={torch} onChange={setTorch} disabled={facing !== "back"} />
          </View>
        </>
      )}
      {!!error && <Notice error>{error}</Notice>}
    </View>
  );
}

export function ScanCard({ code, format, memberName, churchName }: {
  code: string;
  format: "qr" | "code128";
  memberName: string;
  churchName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [availableWidth, setAvailableWidth] = useState(240);
  let svg: string;
  try {
    svg = bwipjs.toSVG({ bcid: format === "qr" ? "qrcode" : "code128", text: normalizeScanCode(code),
      scale: 3, ...(format === "qr" ? {} : { height: 18 }), padding: 12, backgroundcolor: "FFFFFF" });
  } catch { return <Notice error>Unable to render this card. Reload the member and review the code.</Notice>; }
  const width = format === "qr" ? 240 : Math.max(340, code.length * 14);
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  async function output(share: boolean) {
    setBusy(true);
    setError("");
    try {
      const html = `<html><head><meta charset="utf-8"><style>@page{size:landscape;margin:18mm}body{font-family:sans-serif;color:#000;background:#fff}svg{max-width:100%;height:auto;max-height:250px}p{overflow-wrap:anywhere}</style></head><body><h1>${escape(memberName)}</h1><h2>${escape(churchName)}</h2>${svg}<p>${escape(code)}</p></body></html>`;
      if (share && Platform.OS !== "web") {
        if (!await Sharing.isAvailableAsync()) throw new Error("Sharing is not available on this device.");
        const file = await Print.printToFileAsync({ html });
        try { await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" }); }
        finally { new File(file.uri).delete(); }
      } else await Print.printAsync({ html });
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  return (
    <View style={styles.stack}>
      <Heading>Current card</Heading>
      <Label>{memberName}</Label>
      <Label muted>{churchName}</Label>
      <View onLayout={event => setAvailableWidth(event.nativeEvent.layout.width)} style={{ backgroundColor: "white" }}>
        <View accessibilityLabel={`${format === "qr" ? "QR" : "Barcode"} member card`} accessible>
          <SvgXml xml={svg} width={Math.min(width, availableWidth)} height={format === "qr" ? 240 : 150} />
        </View>
      </View>
      <Label>{code}</Label>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <IconButton icon="print-outline" label="Print member card" disabled={busy} onPress={() => void output(false)} />
        {Platform.OS !== "web" && <IconButton icon="share-outline" label="Share member card" disabled={busy} onPress={() => void output(true)} />}
      </View>
      {!!error && <Notice error>{error}</Notice>}
    </View>
  );
}