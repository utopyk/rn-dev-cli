import React from "react";
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
  onToggle,
}: ProfileBannerProps): React.JSX.Element {
  const theme = useTheme();

  if (collapsed) {
    return (
      <box
        borderStyle="single"
        borderColor={theme.border}
        paddingLeft={1}
        paddingRight={1}
        height={3}
        backgroundColor={theme.bg}
        onMouseDown={onToggle}
      >
        <text color={theme.muted}>{"\u25b6"} </text>
        <text color={theme.accent} bold>{profile.name}</text>
        <text color={theme.muted}> (click or [p] to expand)</text>
      </box>
    );
  }

  return (
    <box
      flexDirection="row"
      borderStyle="single"
      borderColor={theme.border}
      paddingLeft={1}
      paddingRight={1}
      height={3}
      justifyContent="space-between"
      backgroundColor={theme.bg}
      onMouseDown={onToggle}
    >
      <box flexDirection="row" backgroundColor={theme.bg}>
        <text color={theme.muted}>{collapsible ? "\u25bc " : ""}</text>
        <text color={theme.accent} bold>{"\u2699"} {profile.name}</text>
        <text color={theme.muted}> {"\u2502"} </text>
        <text color={theme.success}>{profile.branch}</text>
        <text color={theme.muted}> {"\u2502"} </text>
        <text color={theme.fg}>{profile.platform}</text>
        <text color={theme.muted}> {"\u2502"} </text>
        <text color={profile.mode === "ultra-clean" ? theme.warning : theme.fg}>{profile.mode}</text>
        <text color={theme.muted}> {"\u2502"} </text>
        <text color={theme.fg}>:{profile.metroPort}</text>
        <text color={theme.muted}> {"\u2502"} </text>
        <text color={theme.fg}>{profile.buildVariant}</text>
      </box>
      {collapsible && (
        <text color={theme.muted}>[p] toggle</text>
      )}
    </box>
  );
}
