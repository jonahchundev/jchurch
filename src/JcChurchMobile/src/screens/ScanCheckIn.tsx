import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { api, churchPath } from "../api/hooks";
import { ApiError, message } from "../api/client";
import type { ScanResult } from "../api/types";
import { ScanInput, useScanActive } from "../ScanCode";
import { sessionTime } from "../domain";
import { Button, Heading, Label, Notice, styles } from "../ui";

export default function ScanCheckIn({ churchId, eventId, occurrenceId, timeZone, format, onLocked }: {
  churchId: string;
  eventId: string;
  occurrenceId: string;
  timeZone: string;
  format: "qr" | "code128";
  onLocked: (locked: boolean) => void;
}) {
  const client = useQueryClient();
  const active = useScanActive();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const latch = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  useEffect(() => {
    if (!active) { setBusy(false); latch.current = false; }
    return () => { generation.current++; controller.current?.abort(); };
  }, [active]);
  useEffect(() => { onLocked(busy || !!pending); }, [busy, pending, onLocked]);
  useEffect(() => () => onLocked(false), [onLocked]);

  async function process(code: string, statusOnly = false) {
    if (!active || latch.current || closed || Date.now() < retryAt || (pending && !statusOnly)) return;
    latch.current = true;
    const version = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setPending(code);
    setResult(null);
    setError("");
    const current = () => generation.current === version && !abort.signal.aborted;
    function confirmed(value: ScanResult) {
      if (!current()) return;
      setResult(value);
      setPending("");
      setError("");
      void client.invalidateQueries({ queryKey: [churchPath(churchId, "attendance")] });
      void client.invalidateQueries({ queryKey: [churchPath(churchId, `events/${eventId}/occurrence-check-in-counts`)] });
    }
    async function recover() {
      const status = await api.scanStatus(churchId, occurrenceId, code, abort.signal);
      if (status.checkedIn && status.receipt) confirmed({ member: status.member, receipt: status.receipt, already: true });
      else if (current()) setError("No receipt confirmed yet. Check status again or review attendance before continuing.");
    }
    try {
      if (statusOnly) await recover();
      else confirmed(await api.scanCheckIn(churchId, occurrenceId, code, abort.signal));
    } catch (failure) {
      if (!current()) return;
      if (failure instanceof ApiError && failure.status === 429) {
        setRetryAt(Date.now() + Math.max(1, failure.retryAfter) * 1000);
        if (!statusOnly) setPending("");
        setError(message(failure));
      } else if (!statusOnly && failure instanceof ApiError && failure.uncertain) {
        try { await recover(); }
        catch (recoveryFailure) {
          if (current()) {
            if (recoveryFailure instanceof ApiError && recoveryFailure.status === 429)
              setRetryAt(Date.now() + Math.max(1, recoveryFailure.retryAfter) * 1000);
            setError("Unable to confirm attendance. Check status again or review attendance; the code may have been replaced.");
          }
        }
      } else if (statusOnly) {
        setError("Unable to confirm attendance. Review attendance before continuing; a replaced code cannot recover an earlier receipt.");
      } else {
        setPending("");
        setError(message(failure));
        if (failure instanceof ApiError && failure.status === 409) setClosed(true);
      }
    } finally {
      if (current()) { latch.current = false; setBusy(false); }
    }
  }
  return <View style={styles.stack}>
    <Heading>Scan check-in</Heading>
    <Label>{busy ? "Processing scan" : pending ? "Confirmation pending" : closed ? "Scanning stopped" : "Ready to scan"}</Label>
    <ScanInput format={format} disabled={busy || !!pending || closed || now < retryAt} onScan={code => void process(code)} />
    {result && <Notice>{`${result.member.firstName} ${result.member.lastName}: ${result.already ? "Already checked in" : "Checked in"} · ${sessionTime(result.receipt.checkedInAt, timeZone)}`}</Notice>}
    {!!error && <Notice error>{error}</Notice>}
    {now < retryAt && <Label>Retry in {Math.ceil((retryAt - now) / 1000)} seconds.</Label>}
    {!!pending && !busy && <>
      <Button secondary disabled={now < retryAt} onPress={() => void process(pending, true)}>Check scan status</Button>
      <Notice>Leaving recovery does not cancel the original request. Review Checked In before scanning this member again.</Notice>
      <Button secondary onPress={() => { setPending(""); setError(""); }}>Leave recovery for manual review</Button>
    </>}
  </View>;
}