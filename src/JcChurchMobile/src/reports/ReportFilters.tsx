import { useState } from "react";
import { View } from "react-native";
import { presetRange, type ReportRange } from "./range";
import { DateField, SegmentedControl } from "../ui";

// Range math lives in range.ts (pure module) so it can be unit-tested; re-exported here
// for the report screens.
export { presetRange } from "./range";
export type { ReportRange } from "./range";

export function ReportFilters({
  onChange,
}: {
  onChange: (range: ReportRange) => void;
}) {
  const [preset, setPreset] = useState("90d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  function choose(next: string) {
    setPreset(next);
    onChange(presetRange(next, customFrom, customTo));
  }
  return (
    <View style={{ gap: 12 }}>
      <SegmentedControl
        label="Date range"
        value={preset}
        onChange={choose}
        options={[
          { value: "30d", label: "30 days" },
          { value: "90d", label: "90 days" },
          { value: "ytd", label: "Year to date" },
          { value: "all", label: "All time" },
          { value: "custom", label: "Custom" },
        ]}
      />
      {preset === "custom" && (
        <>
          <DateField
            label="From"
            value={customFrom}
            onChange={(value) => {
              setCustomFrom(value);
              onChange(presetRange("custom", value, customTo));
            }}
          />
          <DateField
            label="To"
            value={customTo}
            onChange={(value) => {
              setCustomTo(value);
              onChange(presetRange("custom", customFrom, value));
            }}
          />
        </>
      )}
    </View>
  );
}
