import React, { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { execSync } from "child_process";
import { useTheme } from "../theme-provider.js";
import { SearchableList } from "../components/index.js";
import { getCurrentBranch } from "../../core/project.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BranchStepProps {
  projectRoot: string;
  worktree: string | null;
  onNext: (branch: string) => void;
  onBack: () => void;
}

interface BranchItem extends Record<string, unknown> {
  label: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRecentBranches(dir: string): string[] {
  try {
    const output = execSync(
      "git branch --sort=-committerdate --format=%(refname:short)",
      {
        cwd: dir,
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf-8",
      }
    );
    return output
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean)
      .slice(0, 20);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// BranchStep
// ---------------------------------------------------------------------------

export function BranchStep({
  projectRoot,
  worktree,
  onNext,
  onBack,
}: BranchStepProps): React.JSX.Element {
  const theme = useTheme();

  // Use worktree path if available, otherwise project root
  const dir = worktree ?? projectRoot;

  const currentBranch = useMemo(() => getCurrentBranch(dir), [dir]);
  const recentBranches = useMemo(() => getRecentBranches(dir), [dir]);

  const items: BranchItem[] = useMemo(() => {
    const seen = new Set<string>();
    const list: BranchItem[] = [];

    // Current branch first
    if (currentBranch) {
      seen.add(currentBranch);
      list.push({
        label: `${currentBranch} (current)`,
        value: currentBranch,
      });
    }

    // Recent branches
    for (const branch of recentBranches) {
      if (!seen.has(branch)) {
        seen.add(branch);
        list.push({ label: branch, value: branch });
      }
    }

    return list;
  }, [currentBranch, recentBranches]);

  function handleSelect(item: BranchItem): void {
    onNext(item.value);
  }

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Text color={theme.fg} bold>
        Select a branch:
      </Text>
      {worktree && (
        <Box marginTop={1}>
          <Text color={theme.muted}>Worktree: {worktree}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        {items.length > 0 ? (
          <SearchableList<BranchItem>
            items={items}
            labelKey="label"
            searchKeys={["label", "value"]}
            onSelect={handleSelect}
            placeholder="Search branches..."
          />
        ) : (
          <Text color={theme.muted}>No branches found</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>Press Esc to go back</Text>
      </Box>
    </Box>
  );
}
