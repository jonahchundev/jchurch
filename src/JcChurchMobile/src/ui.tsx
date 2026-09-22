import {
  createElement,
  useEffect,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Picker } from "@react-native-picker/picker";
import DateTimePicker from "@react-native-community/datetimepicker";
import { DateTime } from "luxon";
import { message } from "./api/client";

export const colors = {
  ink: "#202C2A",
  muted: "#5C6D68",
  primary: "#146B59",
  pale: "#E8F2EE",
  line: "#DCE5E0",
  paper: "#FFFFFF",
  background: "#F5F7F5",
  danger: "#AF3544",
  amber: "#865916",
};
type IconName = ComponentProps<typeof Ionicons>["name"];
export function Icon({
  name,
  color = colors.primary,
  size = 22,
}: {
  name: IconName;
  color?: ComponentProps<typeof Ionicons>["color"];
  size?: number;
}) {
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      accessible={false}
      aria-hidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
export function Label({
  children,
  muted = false,
  small = false,
}: {
  children: ReactNode;
  muted?: boolean;
  small?: boolean;
}) {
  return (
    <Text style={[styles.text, muted && styles.muted, small && styles.small]}>
      {children}
    </Text>
  );
}
export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}
export function IconButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      {...(Platform.OS === "web" ? { title: label } : {})}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Icon name={icon} />
    </Pressable>
  );
}
export function Button({
  children,
  onPress,
  icon,
  secondary = false,
  danger = false,
  disabled = false,
  busy = false,
}: {
  children: string;
  onPress: () => void;
  icon?: IconName;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={children}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        danger && styles.danger,
        (disabled || busy) && { opacity: 0.5 },
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? colors.primary : "white"} />
      ) : icon ? (
        <Icon
          name={icon}
          color={secondary ? colors.primary : "white"}
          size={19}
        />
      ) : null}
      <Text style={[styles.buttonText, secondary && { color: colors.primary }]}>
        {children}
      </Text>
    </Pressable>
  );
}
export function Page({
  title,
  eyebrow,
  children,
  actions,
  refreshing = false,
  onRefresh,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  actions?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.page}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
              />
            ) : undefined
          }
        >
          <View style={styles.pageHeading}>
            <View style={{ flex: 1, gap: 5 }}>
              {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
              <Text accessibilityRole="header" style={styles.title}>
                {title}
              </Text>
            </View>
            <View style={styles.actions}>{actions}</View>
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "Search by name",
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <View style={styles.search}>
      <Icon name="search-outline" color={colors.muted} />
      <TextInput
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChange}
        autoFocus={autoFocus}
        maxLength={100}
        autoCapitalize="none"
        returnKeyType="search"
        style={[styles.text, { flex: 1, minWidth: 0, paddingVertical: 10 }]}
      />
      {value ? (
        <IconButton
          icon="close-outline"
          label="Clear search"
          onPress={() => onChange("")}
        />
      ) : null}
    </View>
  );
}
export function Row({
  title,
  subtitle,
  onPress,
  icon = "chevron-forward",
  badge,
  badgeTone = "default",
  trailing,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  icon?: IconName;
  badge?: string;
  badgeTone?: "default" | "danger";
  trailing?: ReactNode;
  disabled?: boolean;
}) {
  const body = (
    <>
      <View style={styles.rowIcon}>
        <Icon name={icon} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {!!subtitle && (
          <Label muted small>
            {subtitle}
          </Label>
        )}
        {!!badge && (
          <Text style={[styles.badge, badgeTone === "danger" && styles.badgeDanger]}>
            {badge}
          </Text>
        )}
      </View>
      {trailing ??
        (onPress && (
          <Icon name="chevron-forward" color={colors.muted} size={18} />
        ))}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        disabled && { opacity: 0.55 },
        pressed && styles.pressed,
      ]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={styles.row}>{body}</View>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <View
      accessibilityRole={error ? "alert" : undefined}
      style={[styles.notice, error && { backgroundColor: "#FFF0F1" }]}
    >
      <Icon
        name={error ? "alert-circle-outline" : "information-circle-outline"}
        color={error ? colors.danger : colors.primary}
      />
      <View style={{ flex: 1 }}>
        <Label>{children}</Label>
      </View>
    </View>
  );
}
export function QueryState({
  pending,
  error,
  empty,
  onRetry,
  emptyText = "No results found.",
}: {
  pending: boolean;
  error: unknown;
  empty: boolean;
  onRetry: () => void;
  emptyText?: string;
}) {
  if (pending)
    return (
      <View style={styles.empty}>
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Loading"
        />
      </View>
    );
  if (error)
    return (
      <View style={styles.stack}>
        <Notice error>{message(error)}</Notice>
        <Button secondary onPress={onRetry} icon="refresh-outline">
          Retry
        </Button>
      </View>
    );
  if (empty)
    return (
      <View style={styles.empty}>
        <Icon name="file-tray-outline" size={30} />
        <Label muted>{emptyText}</Label>
      </View>
    );
  return null;
}
export function Field({
  label,
  error,
  ...props
}: ComponentProps<typeof TextInput> & { label: string; error?: string }) {
  return (
    <View style={styles.field}>
      <Label small>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[
          styles.input,
          props.editable === false && { backgroundColor: colors.background },
          !!error && { borderColor: colors.danger },
          props.style,
        ]}
      />
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}
export function Select({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  disabled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Label small>{label}</Label>
      <View style={styles.select}>
        <Picker
          accessibilityLabel={label}
          selectedValue={value}
          onValueChange={onChange}
          enabled={!disabled}
          style={{ color: colors.ink, minHeight: 48 }}
        >
          {options.map((option) => (
            <Picker.Item
              key={option.value}
              label={option.label}
              value={option.value}
            />
          ))}
        </Picker>
      </View>
    </View>
  );
}
export function Toggle({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.toggle}>
      <View style={{ flex: 1 }}>
        <Label>{label}</Label>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.primary }}
      />
    </View>
  );
}
export function ViewTabs({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
}) {
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        borderBottomWidth: 1,
        borderBottomColor: colors.line,
      }}
    >
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="tab"
          accessibilityLabel={option.label}
          accessibilityState={{ selected: value === option.value }}
          onPress={() => onChange(option.value)}
          style={{
            flex: 1,
            minHeight: 48,
            justifyContent: "center",
            padding: 12,
            borderBottomWidth: 3,
            borderBottomColor:
              value === option.value ? colors.primary : "transparent",
          }}
        >
          <Text
            style={{
              fontFamily: "Manrope_600SemiBold",
              color: value === option.value ? colors.primary : colors.muted,
              textAlign: "center",
              fontSize: 15,
            }}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
function WebPickerField({
  label,
  type,
  value,
  onChange,
  error,
  disabled,
}: {
  label: string;
  type: "date" | "datetime-local" | "time";
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled: boolean;
}) {
  const inputStyle: CSSProperties = {
    boxSizing: "border-box",
    width: "100%",
    minHeight: 48,
    border: `1px solid ${error ? colors.danger : colors.line}`,
    borderRadius: 8,
    padding: 12,
    backgroundColor: disabled ? colors.background : colors.paper,
    color: colors.ink,
    fontFamily: "Manrope_400Regular",
    fontSize: 16,
  };
  return (
    <View style={styles.field}>
      <Label small>{label}</Label>
      {createElement("input", {
        "aria-label": label,
        disabled,
        onChange: (event: ChangeEvent<HTMLInputElement>) =>
          onChange(event.currentTarget.value),
        style: inputStyle,
        type,
        value,
      })}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}
export function DateField({
  label,
  value,
  onChange,
  time = false,
  error,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  time?: boolean;
  error?: string;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<"date" | "time" | null>(null);
  const displayDate = (input: string) => {
    const parsed = DateTime.fromISO(input);
    return parsed.isValid ? parsed.toFormat("M/d/yyyy") : input;
  };
  if (Platform.OS === "web")
    return (
      <WebPickerField
        label={label}
        type={time ? "datetime-local" : "date"}
        value={value}
        onChange={onChange}
        disabled={disabled}
        error={error}
      />
    );
  const parsed = DateTime.fromISO(value || DateTime.local().toISO()!);
  const date = parsed.isValid ? parsed.toJSDate() : new Date();
  return (
    <View style={styles.field}>
      <Label small>{label}</Label>
      <View style={styles.actions}>
        <Button
          secondary
          disabled={disabled}
          icon="calendar-outline"
          onPress={() => setMode("date")}
        >
          {value ? displayDate(value) : "Choose date"}
        </Button>
        {time && (
          <Button
            secondary
            disabled={disabled}
            icon="time-outline"
            onPress={() => setMode("time")}
          >
            {value.slice(11, 16) || "Choose time"}
          </Button>
        )}
        {!time && !!value && (
          <IconButton
            icon="close-outline"
            label={`Clear ${label}`}
            disabled={disabled}
            onPress={() => onChange("")}
          />
        )}
      </View>
      {mode && (
        <DateTimePicker
          value={date}
          mode={mode}
          onChange={(event, selected) => {
            setMode(null);
            if (event.type === "set" && selected)
              onChange(
                DateTime.fromJSDate(selected).toFormat(
                  time ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd",
                ),
              );
          }}
        />
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}
export function TimeField({
  label,
  value,
  onChange,
  error,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const parsed = DateTime.fromFormat(value, "HH:mm");
  const display = parsed.isValid ? parsed.toFormat("h:mm a") : value;
  if (Platform.OS === "web")
    return (
      <WebPickerField
        label={label}
        type="time"
        value={value}
        onChange={onChange}
        disabled={disabled}
        error={error}
      />
    );
  return (
    <View style={styles.field}>
      <Label small>{label}</Label>
      <Button
        secondary
        disabled={disabled}
        icon="time-outline"
        onPress={() => setOpen(true)}
      >
        {parsed.isValid ? display : "Choose time"}
      </Button>
      {open && (
        <DateTimePicker
          value={parsed.isValid ? parsed.toJSDate() : new Date()}
          mode="time"
          onChange={(event, selected) => {
            setOpen(false);
            if (event.type === "set" && selected)
              onChange(DateTime.fromJSDate(selected).toFormat("HH:mm"));
          }}
        />
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}
export function Sheet({
  title,
  children,
  onClose,
  dirty = false,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  dirty?: boolean;
  busy?: boolean;
}) {
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web" || !dirty) return;
    const listener = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty]);
  const close = () => {
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <SafeAreaView style={styles.page}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.sheetHeader}>
            <Heading>{title}</Heading>
            <IconButton
              icon="close-outline"
              label="Close"
              onPress={close}
              disabled={busy}
            />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            {confirmClose ? (
              <View style={styles.stack}>
                <Heading>Discard unsaved changes?</Heading>
                <Button secondary onPress={() => setConfirmClose(false)}>
                  Keep editing
                </Button>
                <Button danger onPress={onClose}>
                  Discard changes
                </Button>
              </View>
            ) : (
              children
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: {
    width: "100%",
    maxWidth: 850,
    alignSelf: "center",
    padding: 20,
    paddingBottom: 40,
    gap: 18,
    flexGrow: 1,
  },
  pageHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  title: {
    fontFamily: "Manrope_700Bold",
    fontSize: 28,
    lineHeight: 36,
    color: colors.ink,
  },
  eyebrow: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 12,
    color: colors.primary,
    textTransform: "uppercase",
  },
  heading: {
    fontFamily: "Manrope_700Bold",
    fontSize: 20,
    color: colors.ink,
    flexShrink: 1,
  },
  text: {
    fontFamily: "Manrope_400Regular",
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  muted: { color: colors.muted },
  small: { fontSize: 13, lineHeight: 20 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },
  stack: { gap: 16 },
  button: {
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flexShrink: 1,
  },
  secondary: {
    backgroundColor: colors.pale,
    borderWidth: 1,
    borderColor: colors.line,
  },
  danger: { backgroundColor: colors.danger },
  buttonText: {
    color: "white",
    fontFamily: "Manrope_600SemiBold",
    fontSize: 15,
    textAlign: "center",
    flexShrink: 1,
  },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  pressed: { opacity: 0.7 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    borderRadius: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowIcon: {
    width: 44,
    height: 44,
    backgroundColor: colors.pale,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 16,
    color: colors.ink,
  },
  badge: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 12,
    color: colors.primary,
  },
  badgeDanger: { color: colors.danger },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: colors.pale,
    padding: 14,
    borderRadius: 8,
  },
  empty: { alignItems: "center", paddingVertical: 36, gap: 14 },
  field: { gap: 6 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    padding: 12,
    backgroundColor: colors.paper,
    color: colors.ink,
    fontFamily: "Manrope_400Regular",
    fontSize: 16,
  },
  select: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    backgroundColor: colors.paper,
    overflow: "hidden",
  },
  error: {
    color: colors.danger,
    fontFamily: "Manrope_400Regular",
    fontSize: 13,
  },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    minHeight: 48,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
});
