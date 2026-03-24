import React, { useState, useMemo, useCallback } from "react";
import { basename } from "path";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../theme-provider.js";
import { SearchableList } from "../components/index.js";
import { getWorktrees } from "../../core/project.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorktreeStepProps {
  projectRoot: string;
  onNext: (worktree: string | null) => void;
  onBack?: () => void;
}

interface WorktreeItem extends Record<string, unknown> {
  label: string;
  value: string | null;
  isCreate?: boolean;
}

// ---------------------------------------------------------------------------
// WorktreeStep
// ---------------------------------------------------------------------------

export function WorktreeStep({
  projectRoot,
  onNext,
  onBack,
}: WorktreeStepProps): React.JSX.Element {
  const theme = useTheme();
  const [creatingNew, setCreatingNew] = useState(false);
  const [newBranch, setNewBranch] = useState("");

  const worktrees = useMemo(() => getWorktrees(projectRoot), [projectRoot]);

  const items: WorktreeItem[] = useMemo(() => {
    const list: WorktreeItem[] = [
      {
        label: "\ud83d\udcc1 Default (root repository)",
        value: null,
      },
    ];

    for (const wt of worktrees) {
      if (!wt.isMain) {
        const folderName = basename(wt.path);
        const branchName = wt.branch.replace(/^refs\/heads\//, "");
        list.push({
          label: `\ud83d\udcc2 ${folderName} \u2192 ${branchName}`,
          value: wt.path,
        });
      }
    }

    list.push({
      label: "+ Create new worktree",
      value: "__create__",
      isCreate: true,
    });

    return list;
  }, [worktrees]);

  function handleSelect(item: WorktreeItem): void {
    if (item.isCreate) {
      setCreatingNew(true);
      return;
    }
    onNext(item.value);
  }

  useKeyboard(
    useCallback(
      (event: { name: string }) => {
        if (event.name === "escape" && onBack) {
          if (creatingNew) {
            setCreatingNew(false);
          } else {
            onBack();
          }
        }
      },
      [onBack, creatingNew]
    )
  );

  if (creatingNew) {
    function handleSubmit(value: string): void {
      if (value.trim()) {
        onNext(value.trim());
      }
    }

    return (
      <box flexDirection="column">
        <text color={theme.fg} bold>
          New worktree branch name:
        </text>
        <box marginTop={1}>
          <text color={theme.accent}>{"\u276f"} </text>
          <input
            focused={true}
            onInput={(val: string) => setNewBranch(val)}
            onSubmit={handleSubmit}
            placeholder="feature/my-branch"
          />
        </box>
        <box marginTop={1}>
          <text color={theme.muted}>Press Esc to go back</text>
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column">
      <text color={theme.fg} bold>
        Select a worktree:
      </text>
      <box marginTop={1}>
        <SearchableList<WorktreeItem>
          items={items}
          labelKey="label"
          searchKeys={["label"]}
          onSelect={handleSelect}
          placeholder="Search worktrees..."
        />
      </box>
      {onBack && (
        <box marginTop={1}>
          <text color={theme.muted}>Press Esc to cancel</text>
        </box>
      )}
    </box>
  );
}
