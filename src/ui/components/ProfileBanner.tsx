import React from "react";
import { Box, Text } from "ink";
import type { Profile } from "../../core/types.js";
import { useTheme } from "../theme-provider.js";

export interface ProfileBannerProps {
  profile: Profile;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function ProfileBanner({
  profile,
  collapsible = false,
  collapsed = false,
}: ProfileBannerProps): React.JSX.Element {
  const theme = useTheme();

  if (collapsed) {
    const indicator = collapsible ? "\u25b6 " : "";
    return (
      <Box>
        <Text color={theme.accent} bold>
          {indicator}\u2699 Profile:{" "}
        </Text>
        <Text color={theme.fg}>{profile.name}</Text>
        <Text color={theme.muted}> (collapsed)</Text>
      </Box>
    );
  }

  const separator = <Text color={theme.muted}> \u2502 </Text>;
  const indicator = collapsible ? "\u25bc " : "";

  const deviceLabel =
    profile.devices.ios && profile.devices.android
      ? `${profile.devices.ios}, ${profile.devices.android}`
      : profile.devices.ios ?? profile.devices.android ?? "auto";

  return (
    <Box>
      <Text color={theme.accent} bold>
        {indicator}\u2699 Profile:{" "}
      </Text>
      <Text color={theme.fg}>{profile.name}</Text>
      {separator}
      <Text color={theme.fg}>{profile.branch}</Text>
      {separator}
      <Text color={theme.fg}>{profile.platform}</Text>
      {separator}
      <Text color={theme.fg}>{profile.mode}</Text>
      {separator}
      <Text color={theme.fg}>:{profile.metroPort}</Text>
      {separator}
      <Text color={theme.fg}>{deviceLabel}</Text>
    </Box>
  );
}
