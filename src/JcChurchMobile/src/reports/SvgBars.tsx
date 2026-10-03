import { Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { colors, Label, styles } from "../ui";

// Lightweight horizontal bar list built on react-native-svg (no chart library).
// Bars are scaled to the largest value; each row exposes a text accessibility label.
export function SvgBars({
  items,
  emptyText = "No data in this range.",
}: {
  items: { label: string; value: number }[];
  emptyText?: string;
}) {
  const max = Math.max(0, ...items.map((item) => item.value));
  if (!items.length) return <Label muted>{emptyText}</Label>;
  return (
    <View style={{ gap: 10 }}>
      {items.map((item) => {
        const percent = max > 0 ? (item.value / max) * 100 : 0;
        return (
          <View
            key={item.label}
            accessible
            accessibilityLabel={`${item.label}: ${item.value}`}
            style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
          >
            <Text
              numberOfLines={1}
              style={[styles.text, styles.small, { width: 96, color: colors.muted }]}
            >
              {item.label}
            </Text>
            <View style={{ flex: 1 }}>
              <Svg width="100%" height={16}>
                <Rect x={0} y={0} width="100%" height={16} rx={4} fill={colors.pale} />
                <Rect
                  x={0}
                  y={0}
                  width={`${item.value > 0 ? Math.max(percent, 3) : 0}%`}
                  height={16}
                  rx={4}
                  fill={colors.primary}
                />
              </Svg>
            </View>
            <Text
              style={[
                styles.text,
                styles.small,
                { width: 44, textAlign: "right", fontFamily: "Manrope_600SemiBold" },
              ]}
            >
              {item.value}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
