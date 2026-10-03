import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, churchPath, memberImageUrl, useAll, useDebounce } from "../api/hooks";
import { message } from "../api/client";
import type { Group, Member } from "../api/types";
import { createdOnLabel, memberAge } from "../domain";
import { findDuplicateCandidates, matchReasonText, type CandidatePair } from "../duplicates";
import { canManageUsers } from "../auth/roles";
import { useRole } from "../auth/RoleContext";
import { groupNames, memberName } from "./Members";
import {
  Avatar,
  Button,
  colors,
  Heading,
  Icon,
  IconButton,
  Label,
  Notice,
  Page,
  QueryState,
  SearchBox,
  SegmentedControl,
  Sheet,
  styles,
  Toggle,
} from "../ui";

type MergePreview = { keeperCheckIns: number; loserCheckIns: number; movable: number; skipped: number };
type MergeResult = { kept: string; archived: string; checkInsMoved: number; checkInsSkipped: number };

export default function Duplicates() {
  const { churchId } = useLocalSearchParams<{ churchId: string }>();
  const router = useRouter();
  const { roleReady, roleInfo } = useRole();
  const membersPath = churchPath(churchId, "members");
  const members = useAll<Member>(membersPath);
  const groups = useAll<Group>(churchPath(churchId, "groups"), { includeArchived: true });
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [nameSort, setNameSort] = useState("asc");
  const [sortOpen, setSortOpen] = useState(false);
  const [resolving, setResolving] = useState<CandidatePair | null>(null);
  const [notice, setNotice] = useState("");

  const candidates = useMemo(() => findDuplicateCandidates(members.data ?? []), [members.data]);
  const filtered = useMemo(() => {
    const term = debounced.trim().toLowerCase();
    let pairs = candidates;
    if (groupIds.length)
      pairs = pairs.filter((pair) =>
        [pair.a, pair.b].some((member) => (member.groupIds ?? []).some((id) => groupIds.includes(id))));
    if (term)
      pairs = pairs.filter((pair) =>
        memberName(pair.a).toLowerCase().includes(term) || memberName(pair.b).toLowerCase().includes(term));
    const direction = nameSort === "desc" ? -1 : 1;
    pairs = [...pairs].sort((left, right) => {
      const last = direction * left.a.lastName.localeCompare(right.a.lastName);
      if (last !== 0) return last;
      return direction * left.a.firstName.localeCompare(right.a.firstName);
    });
    return pairs;
  }, [candidates, debounced, groupIds, nameSort]);

  if (roleReady && !canManageUsers(roleInfo))
    return (
      <Page title="Duplicate members" eyebrow="Members">
        <View style={styles.stack}>
          <Notice error>Only church administrators can clean up duplicate members.</Notice>
          <Button secondary onPress={() => router.back()}>Go back</Button>
        </View>
      </Page>
    );

  return (
    <Page
      title="Duplicate members"
      eyebrow="Members"
      onRefresh={() => void members.refetch()}
      refreshing={members.isRefetching}
      actions={
        <IconButton
          icon="arrow-back-outline"
          label="Back to members"
          onPress={() => router.back()}
        />
      }
    >
      <View style={styles.stack}>
        {!!notice && <Notice>{notice}</Notice>}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <SearchBox value={search} onChange={setSearch} placeholder="Search candidates" />
          </View>
          <IconButton icon="swap-vertical-outline" label="Sort and filter candidates" onPress={() => setSortOpen(true)} />
        </View>
        <QueryState
          pending={members.isPending}
          error={members.error}
          empty={!members.isPending && candidates.length === 0}
          emptyText="No duplicate candidates found."
          onRetry={() => void members.refetch()}
        />
        {!members.isPending && candidates.length > 0 && (
          <Label muted>{filtered.length} of {candidates.length} possible duplicate {candidates.length === 1 ? "pair" : "pairs"}</Label>
        )}
        {filtered.map((pair) => (
          <PairCard
            key={`${pair.a.id}:${pair.b.id}`}
            pair={pair}
            churchId={churchId!}
            onPress={() => setResolving(pair)}
          />
        ))}
      </View>
      {sortOpen && (
        <Sheet title="Candidate sort and filter" onClose={() => setSortOpen(false)}>
          <View style={styles.stack}>
            <Label small>Group or subgroup</Label>
            <Label small muted>Leave all unchecked to show every pair.</Label>
            {(groups.data ?? [])
              .filter((group) => group.active)
              .map((group) => (
                <Toggle
                  key={group.id}
                  compact
                  label={
                    group.parentGroupId
                      ? `${groups.data?.find((parent) => parent.id === group.parentGroupId)?.name ?? "Group"} / ${group.name}`
                      : group.name
                  }
                  value={groupIds.includes(group.id)}
                  onChange={(checked) =>
                    setGroupIds((current) =>
                      checked ? [...current, group.id] : current.filter((id) => id !== group.id),
                    )
                  }
                />
              ))}
            <SegmentedControl label="Name order" value={nameSort} onChange={setNameSort} options={[
              { value: "asc", label: "A-Z" },
              { value: "desc", label: "Z-A" },
            ]} />
          </View>
        </Sheet>
      )}
      {resolving && (
        <ResolveDuplicate
          churchId={churchId!}
          pair={resolving}
          groups={groups.data ?? []}
          onClose={() => setResolving(null)}
          onMerged={(result) => {
            setResolving(null);
            setNotice(`Merged — ${result.checkInsMoved} check-in${result.checkInsMoved === 1 ? "" : "s"} moved${result.checkInsSkipped ? `, ${result.checkInsSkipped} already counted` : ""}.`);
          }}
        />
      )}
    </Page>
  );
}

function PairCard({ pair, churchId, onPress }: { pair: CandidatePair; churchId: string; onPress: () => void }) {
  const summary = (member: Member) =>
    [member.memberType === "child" ? "Child" : "Adult", memberAge(member.birthDate) != null ? `Age ${memberAge(member.birthDate)}` : null]
      .filter(Boolean)
      .join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Review possible duplicate ${memberName(pair.a)}`}
      onPress={onPress}
      style={({ pressed }) => [local.pairCard, pressed && styles.pressed]}
    >
      <View style={local.pairRow}>
        <PairMember member={pair.a} churchId={churchId} summary={summary} />
        <Icon name="swap-horizontal-outline" color={colors.muted} size={20} />
        <PairMember member={pair.b} churchId={churchId} summary={summary} />
      </View>
      <View style={local.pairFooter}>
        <Label small muted>{matchReasonText(pair)}</Label>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Label small>Review</Label>
          <Icon name="chevron-forward" size={16} />
        </View>
      </View>
    </Pressable>
  );
}

function PairMember({ member, churchId, summary }: { member: Member; churchId: string; summary: (m: Member) => string }) {
  return (
    <View style={local.pairMember}>
      <Avatar uri={memberImageUrl(churchId, member.id, member.imageVersion)} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{memberName(member)}</Text>
        <Label small muted>{summary(member)}</Label>
      </View>
    </View>
  );
}

// Which side supplies each pickable field: the keeper (default) or the loser.
type FieldSource = "keeper" | "loser";
type PickState = {
  email: FieldSource;
  phone: FieldSource;
  birthDate: FieldSource;
  gender: FieldSource;
  school: FieldSource;
  allergyDetail: FieldSource;
  scanCode: FieldSource;
  guardians: FieldSource;
  groups: "keeper" | "loser" | "combine";
};

const KEEPER_DEFAULT: PickState = {
  email: "keeper", phone: "keeper", birthDate: "keeper", gender: "keeper",
  school: "keeper", allergyDetail: "keeper", scanCode: "keeper", guardians: "keeper", groups: "keeper",
};

function ResolveDuplicate({
  churchId,
  pair,
  groups,
  onClose,
  onMerged,
}: {
  churchId: string;
  pair: CandidatePair;
  groups: Group[];
  onClose: () => void;
  onMerged: (result: MergeResult) => void;
}) {
  const client = useQueryClient();
  const membersPath = churchPath(churchId, "members");
  // The keeper is the member the surviving record keeps; default to the first of the pair.
  const [keepId, setKeepId] = useState<string>(pair.a.id);
  const [picks, setPicks] = useState<PickState>(KEEPER_DEFAULT);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const keeper = keepId === pair.a.id ? pair.a : pair.b;
  const loser = keepId === pair.a.id ? pair.b : pair.a;
  const mergePath = churchPath(churchId, `members/${encodeURIComponent(keeper.id)}/merge`);

  // Live preview of how many check-ins move / are skipped for the current keeper choice.
  const preview = useQuery<MergePreview>({
    queryKey: [mergePath, "preview", loser.id],
    queryFn: ({ signal }) =>
      api.save<MergePreview>(`${mergePath}?dryRun=true`, { loserId: loser.id }),
  });

  function pick<K extends keyof PickState>(field: K, value: PickState[K]) {
    setPicks((current) => ({ ...current, [field]: value }));
  }

  function chooseKeeper(id: string) {
    setKeepId(id);
    setPicks(KEEPER_DEFAULT);
    setConfirming(false);
    setError("");
  }

  // Build the optional keeperUpdate from the field picks. Undefined when every pick is the keeper's own value.
  function keeperUpdate(): Record<string, unknown> | undefined {
    const changes: Record<string, unknown> = {};
    if (picks.email === "loser") changes.email = loser.email ?? null;
    if (picks.phone === "loser") changes.phone = loser.phone ?? null;
    if (picks.birthDate === "loser") changes.birthDate = loser.birthDate ?? null;
    if (picks.gender === "loser") changes.gender = loser.gender ?? null;
    if (picks.school === "loser") changes.school = loser.school ?? null;
    if (picks.allergyDetail === "loser") changes.allergyDetail = loser.allergyDetail ?? null;
    if (picks.scanCode === "loser") changes.scanCode = loser.scanCode ?? null;
    if (picks.guardians === "loser") {
      changes.guardian1 = loser.guardian1 ?? null;
      changes.guardian2 = loser.guardian2 ?? null;
    }
    if (picks.groups === "loser") changes.groupIds = loser.groupIds ?? [];
    if (picks.groups === "combine") changes.groupIds = Array.from(new Set([...(keeper.groupIds ?? []), ...(loser.groupIds ?? [])]));
    if (Object.keys(changes).length === 0) return undefined;
    // The server expects a full member body; start from the keeper and overlay the picks.
    return { ...keeper, ...changes };
  }

  const merge = useMutation({
    mutationFn: () =>
      api.save<MergeResult>(mergePath, {
        loserId: loser.id,
        loserEtag: loser._etag,
        keeperEtag: keeper._etag,
        keeperUpdate: keeperUpdate(),
      }),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: [membersPath] });
      await client.invalidateQueries({ queryKey: [churchPath(churchId, "attendance")] });
      onMerged(result);
    },
    onError: (cause) => {
      setConfirming(false);
      setError(message(cause));
    },
  });

  const previewLine = preview.data
    ? `${preview.data.movable} check-in${preview.data.movable === 1 ? "" : "s"} will move · ${preview.data.skipped} skipped (already checked in) · ${memberName(loser)} archived`
    : null;

  return (
    <Sheet title="Resolve duplicate" onClose={onClose} busy={merge.isPending}>
      <View style={styles.stack}>
        <Label muted>Tap the card to keep. Check-ins from the other member move to the keeper.</Label>
        {!!error && <Notice error>{error}</Notice>}

        <View style={local.cardsRow}>
          <CompareCard member={pair.a} other={pair.b} churchId={churchId} groups={groups} selected={keepId === pair.a.id} onSelect={() => chooseKeeper(pair.a.id)} />
          <CompareCard member={pair.b} other={pair.a} churchId={churchId} groups={groups} selected={keepId === pair.b.id} onSelect={() => chooseKeeper(pair.b.id)} />
        </View>

        <FieldPicks keeper={keeper} loser={loser} picks={picks} onPick={pick} />

        {preview.isPending ? (
          <Label muted>Counting check-ins…</Label>
        ) : preview.error ? (
          <Notice error>{message(preview.error)}</Notice>
        ) : previewLine ? (
          <Notice>{previewLine}</Notice>
        ) : null}

        {confirming ? (
          <View style={styles.stack}>
            <Notice error>
              {`Keep ${memberName(keeper)} and archive ${memberName(loser)}? ${preview.data?.movable ?? 0} check-in${preview.data?.movable === 1 ? "" : "s"} move to the keeper. This cannot be undone.`}
            </Notice>
            <Button secondary onPress={() => setConfirming(false)}>Back</Button>
            <Button danger busy={merge.isPending} onPress={() => merge.mutate()}>
              {`Merge into ${memberName(keeper)}`}
            </Button>
          </View>
        ) : (
          <Button onPress={() => setConfirming(true)} disabled={preview.isPending || !!preview.error}>
            {`Merge into ${memberName(keeper)}`}
          </Button>
        )}
      </View>
    </Sheet>
  );
}

function CompareCard({
  member,
  churchId,
  groups,
  selected,
  onSelect,
}: {
  member: Member;
  other: Member;
  churchId: string;
  groups: Group[];
  selected: boolean;
  onSelect: () => void;
}) {
  const lines: string[] = [];
  lines.push(member.memberType === "child" ? "Child" : "Adult");
  const age = memberAge(member.birthDate);
  if (age != null) lines.push(`Age ${age}`);
  if (member.gender) lines.push(member.gender);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Keep ${memberName(member)}`}
      accessibilityState={{ selected }}
      onPress={onSelect}
      style={[local.compareCard, selected && local.compareCardSelected]}
    >
      <View style={{ alignItems: "center", gap: 6 }}>
        <Avatar uri={memberImageUrl(churchId, member.id, member.imageVersion)} size={56} />
        <Text style={styles.rowTitle}>{memberName(member)}</Text>
        <View style={[local.keepPill, selected && local.keepPillSelected]}>
          <Label small>{selected ? "✓ Keeping" : "Keep this one"}</Label>
        </View>
      </View>
      <CardLine icon="person-outline" text={lines.join(" · ")} />
      <CardLine icon="mail-outline" text={member.email ?? "—"} />
      <CardLine icon="call-outline" text={member.phone ?? "—"} />
      <CardLine icon="people-outline" text={guardianSummary(member)} />
      <CardLine icon="school-outline" text={member.school ?? "—"} />
      <CardLine icon="albums-outline" text={member.groupIds?.length ? groupNames(member, groups) : "No groups"} />
      <CardLine icon="barcode-outline" text={member.scanCode ? "Scan code: yes" : "Scan code: no"} />
      <CardLine icon="calendar-outline" text={createdOnLabel(member.createdOn)} />
      {!selected && <Label small muted>Will be archived</Label>}
    </Pressable>
  );
}

function CardLine({ icon, text }: { icon: ComponentProps<typeof Icon>["name"]; text: string }) {
  return (
    <View style={local.cardLine}>
      <Icon name={icon} size={16} color={colors.muted} />
      <Text style={local.cardLineText} numberOfLines={2}>{text}</Text>
    </View>
  );
}

function guardianSummary(member: Member): string {
  const guardians = [member.guardian1, member.guardian2]
    .filter((guardian) => guardian && (guardian.firstName || guardian.lastName))
    .map((guardian) => {
      const name = [guardian!.firstName, guardian!.lastName].filter(Boolean).join(" ");
      const detail = guardian!.phone || guardian!.email || "";
      return detail ? `${name} (${detail})` : name;
    });
  return guardians.length ? guardians.join("; ") : "—";
}

function FieldPicks({
  keeper,
  loser,
  picks,
  onPick,
}: {
  keeper: Member;
  loser: Member;
  picks: PickState;
  onPick: <K extends keyof PickState>(field: K, value: PickState[K]) => void;
}) {
  // Only show a picker for a field when the two members actually differ.
  const rows: { key: keyof PickState; label: string; keeperValue: string; loserValue: string; kind?: "groups" }[] = [
    { key: "email", label: "Email", keeperValue: keeper.email ?? "—", loserValue: loser.email ?? "—" },
    { key: "phone", label: "Phone", keeperValue: keeper.phone ?? "—", loserValue: loser.phone ?? "—" },
    { key: "birthDate", label: "Birth date", keeperValue: keeper.birthDate ?? "—", loserValue: loser.birthDate ?? "—" },
    { key: "gender", label: "Gender", keeperValue: keeper.gender ?? "—", loserValue: loser.gender ?? "—" },
    { key: "school", label: "School", keeperValue: keeper.school ?? "—", loserValue: loser.school ?? "—" },
    { key: "allergyDetail", label: "Allergy", keeperValue: keeper.allergyDetail ?? "—", loserValue: loser.allergyDetail ?? "—" },
    { key: "scanCode", label: "Scan code", keeperValue: keeper.scanCode ? "Assigned" : "—", loserValue: loser.scanCode ? "Assigned" : "—" },
    { key: "guardians", label: "Guardians", keeperValue: guardianSummary(keeper), loserValue: guardianSummary(loser) },
    { key: "groups", label: "Groups", keeperValue: keeper.groupIds?.length ? `${keeper.groupIds.length} group(s)` : "—", loserValue: loser.groupIds?.length ? `${loser.groupIds.length} group(s)` : "—", kind: "groups" },
  ];
  const differing = rows.filter((row) => row.keeperValue !== row.loserValue);
  if (differing.length === 0) return null;
  return (
    <View style={styles.stack}>
      <Heading>Fields to keep</Heading>
      <Label small muted>Defaults to the kept member. Choose the other value where it differs.</Label>
      {differing.map((row) => (
        <PickRow key={row.key} row={row} picks={picks} onPick={onPick} />
      ))}
    </View>
  );
}

function PickRow({
  row,
  picks,
  onPick,
}: {
  row: { key: keyof PickState; label: string; keeperValue: string; loserValue: string; kind?: "groups" };
  picks: PickState;
  onPick: <K extends keyof PickState>(field: K, value: PickState[K]) => void;
}) {
  const value = picks[row.key];
  const options = row.kind === "groups"
    ? [
        { label: `Keep: ${row.keeperValue}`, value: "keeper" },
        { label: `Other: ${row.loserValue}`, value: "loser" },
        { label: "Combine", value: "combine" },
      ]
    : [
        { label: `Keep: ${row.keeperValue}`, value: "keeper" },
        { label: `Other: ${row.loserValue}`, value: "loser" },
      ];
  return (
    <View style={local.pickRow}>
      <Label small muted>{row.label}</Label>
      <View style={local.pickOptions}>
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityLabel={`${row.label}: ${option.label}`}
              accessibilityState={{ selected }}
              onPress={() => onPick(row.key, option.value as never)}
              style={[local.pickOption, selected && local.pickOptionSelected]}
            >
              <Text style={[local.pickOptionText, selected && { color: colors.primary }]} numberOfLines={1}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

import type { ComponentProps } from "react";

const local = StyleSheet.create({
  pairCard: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  pairRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pairMember: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  pairFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 },
  cardsRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  compareCard: {
    flexGrow: 1,
    flexBasis: 240,
    minWidth: 240,
    backgroundColor: colors.paper,
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  compareCardSelected: { borderColor: colors.primary, backgroundColor: colors.pale },
  keepPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.line },
  keepPillSelected: { backgroundColor: colors.paper, borderColor: colors.primary },
  cardLine: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  cardLineText: { flex: 1, color: colors.ink, fontSize: 13, fontFamily: "Manrope_500Medium" },
  pickRow: { gap: 4 },
  pickOptions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pickOption: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, minHeight: 40, justifyContent: "center" },
  pickOptionSelected: { borderColor: colors.primary, backgroundColor: colors.pale },
  pickOptionText: { color: colors.muted, fontSize: 13, fontFamily: "Manrope_600SemiBold" },
});
