import { StyleSheet, Text, View } from "react-native";
import { colors, Label } from "../ui";

// Two-column grid of headline stat cards used at the top of every report screen.
export function StatGrid({
  stats,
}: {
  stats: { label: string; value: string }[];
}) {
  return (
    <View style={grid.grid}>
      {stats.map((stat) => (
        <View key={stat.label} style={grid.card}>
          <Text style={grid.value}>{stat.value}</Text>
          <Label muted small>
            {stat.label}
          </Label>
        </View>
      ))}
    </View>
  );
}

const grid = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 14,
    gap: 4,
  },
  value: {
    fontFamily: "Manrope_700Bold",
    fontSize: 24,
    lineHeight: 30,
    color: colors.ink,
  },
});
