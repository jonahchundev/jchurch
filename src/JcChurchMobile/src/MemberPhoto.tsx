import { useState } from "react";
import { Platform, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useMutation } from "@tanstack/react-query";
import { api, churchPath, memberImageUrl } from "./api/hooks";
import { message } from "./api/client";
import type { Member } from "./api/types";
import { resizeToSquareJpeg } from "./memberPhotoResize";
import { Avatar, Button, Notice } from "./ui";

export type PendingPhoto = { contentType: string; data: string; previewUri: string };

// Picks from camera or library, square-crops, downsizes to a 512px JPEG under the server cap.
export async function pickMemberPhoto(
  source: "camera" | "library",
): Promise<PendingPhoto | null> {
  const allowsEditing = Platform.OS !== "web";
  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted)
      throw new Error("Camera access is needed to take a photo.");
  } else if (Platform.OS !== "web") {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted)
      throw new Error("Photo library access is needed to choose a photo.");
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    allowsEditing,
    aspect: [1, 1],
    quality: 0.8,
  };
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return null;
  const resized = await resizeToSquareJpeg(result.assets[0].uri);
  return {
    contentType: "image/jpeg",
    data: resized.data,
    previewUri: resized.uri,
  };
}

// Photo section for the member editor. Existing members upload/remove immediately;
// a new member has no id yet, so the pick is stashed in `pending` and uploaded after create.
export default function MemberPhoto({
  churchId,
  member,
  disabled,
  onMemberChange,
  pending,
  onPendingChange,
}: {
  churchId: string;
  member?: Member;
  disabled: boolean;
  onMemberChange: (member: Member) => void;
  pending: PendingPhoto | null;
  onPendingChange: (photo: PendingPhoto | null) => void;
}) {
  const [error, setError] = useState("");
  // The image endpoints Replace the member server-side (bumping imageVersion), which rotates its
  // ETag. We re-fetch the member and hand the fresh copy up so the editor's next save PUT uses the
  // current _etag instead of a stale one (412). We deliberately do NOT invalidate the detail query —
  // MemberDetails refetches with gcTime/staleTime 0, which would unmount MemberEditor mid-edit.
  const refreshMember = () =>
    api.get<Member>(churchPath(churchId, `members/${member!.id}`));
  const upload = useMutation({
    mutationFn: async (photo: PendingPhoto) => {
      await api.uploadMemberImage(churchId, member!.id, {
        contentType: photo.contentType,
        data: photo.data,
      });
      return refreshMember();
    },
    onSuccess: (fresh) => onMemberChange(fresh),
    onError: (failure) => setError(message(failure)),
  });
  const remove = useMutation({
    mutationFn: async () => {
      await api.deleteMemberImage(churchId, member!.id);
      return refreshMember();
    },
    onSuccess: (fresh) => onMemberChange(fresh),
    onError: (failure) => setError(message(failure)),
  });
  const busy = upload.isPending || remove.isPending;
  const uri =
    pending?.previewUri ??
    (member ? memberImageUrl(churchId, member.id, member.imageVersion) : null);
  const hasPhoto = !!pending || !!member?.imageVersion;

  async function pick(source: "camera" | "library") {
    setError("");
    try {
      const photo = await pickMemberPhoto(source);
      if (!photo) return;
      if (member) upload.mutate(photo);
      else onPendingChange(photo);
    } catch (failure) {
      setError(message(failure));
    }
  }

  return (
    <View style={{ alignItems: "center", gap: 10 }}>
      <Avatar uri={uri} size={96} />
      {!disabled && (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {Platform.OS !== "web" && (
            <Button
              secondary
              icon="camera-outline"
              busy={upload.isPending}
              disabled={busy}
              onPress={() => void pick("camera")}
            >
              Take photo
            </Button>
          )}
          <Button
            secondary
            icon="images-outline"
            busy={upload.isPending}
            disabled={busy}
            onPress={() => void pick("library")}
          >
            Choose photo
          </Button>
          {hasPhoto && (
            <Button
              secondary
              icon="trash-outline"
              busy={remove.isPending}
              disabled={busy}
              onPress={() => {
                setError("");
                if (member) remove.mutate();
                else onPendingChange(null);
              }}
            >
              Remove photo
            </Button>
          )}
        </View>
      )}
      {!!error && <Notice error>{error}</Notice>}
    </View>
  );
}
