import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../theme-provider.js";
import { SearchableList } from "../components/index.js";
import { getCurrentBranch } from "../../core/project.js";
import { execAsync } from "../../core/exec-async.js";

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

async function getRecentBranches(dir: string): Promise<string[]> {
  try {
    const output = await execAsync(
      "git branch --sort=-committerdate --format=%(refname:short)",
      {
        cwd: dir,
        timeout: 15000,
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

  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [recentBranches, setRecentBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getCurrentBranch(dir),
      getRecentBranches(dir),
    ]).then(([branch, branches]) => {
      if (!cancelled) {
        setCurrentBranch(branch);
        setRecentBranches(branches);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [dir]);

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

  useKeyboard(
    useCallback(
      (event: { name: string }) => {
        if (event.name === "escape") {
          onBack();
        }
      },
      [onBack]
    )
  );

  if (loading) {
    return (
      <box flexDirection="column">
        <text color={theme.muted}>Loading branches...</text>
      </box>
    );
  }

  return (
    <box flexDirection="column">
      <text color={theme.fg} bold>
        Select a branch:
      </text>
      {worktree && (
        <box marginTop={1}>
          <text color={theme.muted}>Worktree: {worktree}</text>
        </box>
      )}
      <box marginTop={1}>
        {items.length > 0 ? (
          <SearchableList<BranchItem>
            items={items}
            labelKey="label"
            searchKeys={["label", "value"]}
            onSelect={handleSelect}
            placeholder="Search branches..."
          />
        ) : (
          <text color={theme.muted}>No branches found</text>
        )}
      </box>
      <box marginTop={1}>
        <text color={theme.muted}>Press Esc to go back</text>
      </box>
    </box>
  );
}
