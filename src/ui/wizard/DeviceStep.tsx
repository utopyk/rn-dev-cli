import React, { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme-provider.js";
import { SearchableList } from "../components/index.js";
import { listDevices } from "../../core/device.js";
import type { Platform, DeviceSelection } from "../../core/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeviceStepProps {
  platform: Platform;
  onNext: (devices: DeviceSelection) => void;
  onBack: () => void;
}

interface DeviceItem extends Record<string, unknown> {
  label: string;
  value: string | null;
  type: "ios" | "android" | "skip";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusIcon(status: string): string {
  switch (status) {
    case "booted":
      return "🟢";
    case "available":
      return "🟡";
    case "unauthorized":
      return "🔒";
    default:
      return "⚪";
  }
}

// ---------------------------------------------------------------------------
// DeviceStep
// ---------------------------------------------------------------------------

export function DeviceStep({
  platform,
  onNext,
  onBack,
}: DeviceStepProps): React.JSX.Element {
  const theme = useTheme();

  // We use a two-phase selection when platform is "both"
  const [iosDeviceId, setIosDeviceId] = React.useState<string | null | undefined>(undefined);

  const devices = useMemo(() => listDevices(platform), [platform]);

  const iosDevices = useMemo(
    () => devices.filter((d) => d.type === "ios"),
    [devices]
  );

  const androidDevices = useMemo(
    () => devices.filter((d) => d.type === "android"),
    [devices]
  );

  const needsIos = platform === "ios" || platform === "both";
  const needsAndroid = platform === "android" || platform === "both";

  // Determine current phase
  const selectingIos = needsIos && iosDeviceId === undefined;
  const selectingAndroid =
    needsAndroid && (!needsIos || iosDeviceId !== undefined);

  function buildIosItems(): DeviceItem[] {
    const items: DeviceItem[] = iosDevices.map((d) => ({
      label: `${statusIcon(d.status)} ${d.name}${d.runtime ? ` (${d.runtime.replace(/-/g, ".")})` : ""}`,
      value: d.id,
      type: "ios",
    }));
    items.push({ label: "⏭  Skip — no iOS device", value: null, type: "skip" });
    return items;
  }

  function buildAndroidItems(): DeviceItem[] {
    const items: DeviceItem[] = androidDevices.map((d) => ({
      label: `${statusIcon(d.status)} ${d.name}`,
      value: d.id,
      type: "android",
    }));
    items.push({ label: "⏭  Skip — no Android device", value: null, type: "skip" });
    return items;
  }

  function handleIosSelect(item: DeviceItem): void {
    const selected = item.value;
    if (!needsAndroid) {
      onNext({ ios: selected });
    } else {
      setIosDeviceId(selected);
    }
  }

  function handleAndroidSelect(item: DeviceItem): void {
    const selected = item.value;
    if (needsIos) {
      onNext({ ios: iosDeviceId ?? null, android: selected });
    } else {
      onNext({ android: selected });
    }
  }

  useInput((_input, key) => {
    if (key.escape) {
      if (selectingAndroid && needsIos) {
        // Go back to iOS selection
        setIosDeviceId(undefined);
      } else {
        onBack();
      }
    }
  });

  if (selectingIos) {
    const items = buildIosItems();
    return (
      <Box flexDirection="column">
        <Text color={theme.fg} bold>
          Select iOS device / simulator:
        </Text>
        {items.length === 1 ? (
          <Box marginTop={1}>
            <Text color={theme.warning}>
              No iOS simulators found. Make sure Xcode is installed.
            </Text>
          </Box>
        ) : (
          <Box marginTop={1}>
            <SearchableList<DeviceItem>
              items={items}
              labelKey="label"
              searchKeys={["label"]}
              onSelect={handleIosSelect}
              placeholder="Search devices..."
            />
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.muted}>Press Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  if (selectingAndroid) {
    const items = buildAndroidItems();
    return (
      <Box flexDirection="column">
        <Text color={theme.fg} bold>
          Select Android device / emulator:
        </Text>
        {needsIos && iosDeviceId !== null && (
          <Box marginTop={1}>
            <Text color={theme.muted}>iOS: {iosDeviceId}</Text>
          </Box>
        )}
        {items.length === 1 ? (
          <Box marginTop={1}>
            <Text color={theme.warning}>
              No Android devices found. Make sure adb is in PATH.
            </Text>
          </Box>
        ) : (
          <Box marginTop={1}>
            <SearchableList<DeviceItem>
              items={items}
              labelKey="label"
              searchKeys={["label"]}
              onSelect={handleAndroidSelect}
              placeholder="Search devices..."
            />
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.muted}>
            {needsIos ? "Press Esc to go back to iOS selection" : "Press Esc to go back"}
          </Text>
        </Box>
      </Box>
    );
  }

  // Fallback (should never render)
  return <Text color={theme.error}>Unexpected state in DeviceStep</Text>;
}
