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
    return (
      <Box>
        <Text color={theme.muted}>▶ </Text>
        <Text color={theme.accent} bold>{profile.name}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text color={theme.muted}>{collapsible ? "▼ " : ""}</Text>
      <Text color={theme.accent} bold>{profile.name}</Text>
      <Text color={theme.muted}> │ </Text>
      <Text color={theme.fg}>{profile.branch}</Text>
      <Text color={theme.muted}> │ </Text>
      <Text color={theme.fg}>{profile.platform}</Text>
      <Text color={theme.muted}> │ </Text>
      <Text color={theme.fg}>{profile.mode}</Text>
      <Text color={theme.muted}> │ </Text>
      <Text color={theme.fg}>:{profile.metroPort}</Text>
    </Box>
  );
}
