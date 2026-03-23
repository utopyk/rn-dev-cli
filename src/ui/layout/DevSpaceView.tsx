import React from "react";
import { Box, Text } from "ink";
import { Panel } from "../components/Panel.js";
import { LogViewer } from "../components/LogViewer.js";
import { useTheme } from "../theme-provider.js";

export interface DevSpaceShortcut {
  key: string;
  label: string;
  action: () => void;
}

export interface DevSpaceViewProps {
  metroLines: string[];
  toolOutputLines: string[];
  shortcuts: DevSpaceShortcut[];
}

export function DevSpaceView({
  metroLines,
  toolOutputLines,
  shortcuts,
}: DevSpaceViewProps): React.JSX.Element {
  const theme = useTheme();

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Top half: shortcuts + tool output side by side */}
      <Box flexDirection="row" flexGrow={1}>
        {/* Left panel: shortcuts list */}
        <Box width="40%">
          <Panel title="Shortcuts" width="100%">
            <Box flexDirection="column">
              {shortcuts.map((s) => (
                <Box key={s.key}>
                  <Text color={theme.accent} bold>
                    [{s.key}]
                  </Text>
                  <Text color={theme.fg}> {s.label}</Text>
                </Box>
              ))}
            </Box>
          </Panel>
        </Box>

        {/* Right panel: tool output */}
        <Box flexGrow={1}>
          <Panel title="Tool Output" width="100%">
            <LogViewer lines={toolOutputLines} follow={true} />
          </Panel>
        </Box>
      </Box>

      {/* Bottom half: Metro output */}
      <Box flexGrow={1}>
        <Panel title="Metro Output" width="100%">
          <LogViewer lines={metroLines} follow={true} />
        </Panel>
      </Box>
    </Box>
  );
}
