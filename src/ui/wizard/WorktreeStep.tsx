import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
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
        label: "📁 Default (root repository)",
        value: null,
      },
    ];

    for (const wt of worktrees) {
      if (!wt.isMain) {
        list.push({
          label: `${wt.path} (${wt.branch})`,
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

  useInput((input, key) => {
    if (key.escape && onBack) {
      if (creatingNew) {
        setCreatingNew(false);
      } else {
        onBack();
      }
    }
  });

  if (creatingNew) {
    function handleSubmit(value: string): void {
      if (value.trim()) {
        // For now, pass the branch name as worktree path hint
        // The actual worktree creation would happen outside the wizard
        onNext(value.trim());
      }
    }

    return (
      <Box flexDirection="column">
        <Text color={theme.fg} bold>
          New worktree branch name:
        </Text>
        <Box marginTop={1}>
          <Text color={theme.accent}>{"\u276f"} </Text>
          <TextInput
            value={newBranch}
            onChange={setNewBranch}
            onSubmit={handleSubmit}
            placeholder="feature/my-branch"
          />
        </Box>
        <Box marginTop={1}>
          <Text color={theme.muted}>Press Esc to go back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text color={theme.fg} bold>
        Select a worktree:
      </Text>
      <Box marginTop={1}>
        <SearchableList<WorktreeItem>
          items={items}
          labelKey="label"
          searchKeys={["label"]}
          onSelect={handleSelect}
          placeholder="Search worktrees..."
        />
      </Box>
      {onBack && (
        <Box marginTop={1}>
          <Text color={theme.muted}>Press Esc to cancel</Text>
        </Box>
      )}
    </Box>
  );
}
