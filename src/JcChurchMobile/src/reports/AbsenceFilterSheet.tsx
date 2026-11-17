import { useState } from "react";
import { View } from "react-native";
import { Button, Field, Notice, SegmentedControl, Select, Sheet, styles } from "../ui";
import { absenceFilterOptions, absencePreset, absenceSortOptions, DEFAULT_ABSENCE_SETTINGS, RECENTLY_ABSENT_SETTINGS, validateAbsenceSettings, type AbsenceSettings } from "./attendanceSequenceFilters";

export function AbsenceFilterSheet({ settings, onApply, onClose }: {
  settings: AbsenceSettings; onApply: (settings: AbsenceSettings) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const update = (patch: Partial<AbsenceSettings>) => setDraft(current => ({ ...current, ...patch }));
  const error = validateAbsenceSettings(draft);
  return (
    <Sheet title="Member sort and filter" onClose={onClose}>
      <View style={styles.stack}>
        <Select label="Attendance preset" value={absencePreset(draft)} onChange={value => {
          if (value === "all") setDraft({ ...DEFAULT_ABSENCE_SETTINGS });
          if (value === "recently-absent") setDraft({ ...RECENTLY_ABSENT_SETTINGS });
        }} options={[
          { value: "all", label: "All members" }, { value: "recently-absent", label: "Recently absent" }, { value: "custom", label: "Custom" },
        ]} />
        <Select label="Attendance filter" value={draft.filter} onChange={value => update({ filter: value as AbsenceSettings["filter"] })} options={absenceFilterOptions} />
        {draft.filter === "consecutive" && <Field label="Minimum consecutive absences" keyboardType="number-pad" value={draft.minimum} onChangeText={minimum => update({ minimum })} />}
        {draft.filter === "recent" && <Field label="Minimum missed sessions" keyboardType="number-pad" value={draft.missed} onChangeText={missed => update({ missed })} />}
        <Field label="Recent session count" keyboardType="number-pad" value={draft.window} onChangeText={window => update({ window })} />
        <Select label="Sequence order" value={draft.sort} onChange={value => update({ sort: value as AbsenceSettings["sort"] })} options={absenceSortOptions} />
        <SegmentedControl label="Name order" value={draft.nameSort} onChange={nameSort => update({ nameSort })} options={[
          { value: "", label: "Off" }, { value: "asc", label: "A-Z" }, { value: "desc", label: "Z-A" },
        ]} />
        <SegmentedControl label="Created date" value={draft.createdSort} onChange={createdSort => update({ createdSort })} options={[
          { value: "", label: "Off" }, { value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" },
        ]} />
        {!!error && <Notice error>{error}</Notice>}
        <Button icon="checkmark-outline" disabled={!!error} onPress={() => onApply(draft)}>Apply filters and sort</Button>
        <Button secondary icon="refresh-outline" onPress={() => setDraft({ ...DEFAULT_ABSENCE_SETTINGS })}>Reset filters and sort</Button>
        <Button secondary icon="close-outline" onPress={onClose}>Cancel</Button>
      </View>
    </Sheet>
  );
}