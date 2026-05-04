/** @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { InstanceTabs, type InstanceInfo } from '../InstanceTabs.js';

// Bug E — discoverability of the two-click close confirm. Pre-fix the
// only signals were a `?` glyph + a tooltip-style chip whose wording
// ("Stop Metro on :PORT?") read as informational. Users reported "the
// close didn't work" because they clicked once and didn't notice that
// the close was now armed. This suite asserts that:
//   - The confirm chip uses imperative wording the test can match
//     ("Click again to close").
//   - The tab itself enters a 'confirming' visual state (CSS class)
//     so the user can't miss the change.
//   - Shift-click bypasses the confirm flow for power users.

const SAMPLE: InstanceInfo = {
  id: 'main-8081',
  worktreeName: 'kimoby-mobile-app',
  branch: 'main',
  port: 8081,
  deviceName: "Martin's iPhone 15",
  deviceIcon: '📱',
  platform: 'ios',
  metroStatus: 'running',
};

function renderTabs(overrides: Partial<React.ComponentProps<typeof InstanceTabs>> = {}) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const onAdd = vi.fn();
  const utils = render(
    <InstanceTabs
      instances={[SAMPLE]}
      activeId={SAMPLE.id}
      onClose={onClose}
      onSelect={onSelect}
      onAdd={onAdd}
      {...overrides}
    />
  );
  return { onClose, onSelect, onAdd, ...utils };
}

describe('InstanceTabs — close affordance (Bug E)', () => {
  beforeEach(() => cleanup());

  it('first click does NOT call onClose; instead surfaces an imperative confirm chip', () => {
    const { onClose } = renderTabs();
    const closeBtn = screen.getByRole('button', { name: /close instance/i });
    fireEvent.click(closeBtn);
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByText(/click again to close/i),
      'Confirm chip should use imperative wording so the user knows the close is armed',
    ).toBeDefined();
  });

  it('second click confirms and calls onClose with the instance id', () => {
    const { onClose } = renderTabs();
    const closeBtn = screen.getByRole('button', { name: /close instance/i });
    fireEvent.click(closeBtn); // arms
    // Re-query — aria-label flips to "Click again to close ..."
    const armedBtn = screen.getByRole('button', { name: /click again to close/i });
    fireEvent.click(armedBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(SAMPLE.id);
  });

  it('marks the entire tab with the .confirming CSS class so the visual signal is unmissable', () => {
    const { container } = renderTabs();
    const closeBtn = screen.getByRole('button', { name: /close instance/i });
    fireEvent.click(closeBtn);
    const tab = container.querySelector('.instance-tab');
    expect(tab?.classList.contains('confirming')).toBe(true);
  });

  it('shift-click on the close button bypasses the confirm flow', () => {
    const { onClose } = renderTabs();
    const closeBtn = screen.getByRole('button', { name: /close instance/i });
    fireEvent.click(closeBtn, { shiftKey: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(SAMPLE.id);
    // No confirm chip should have appeared.
    expect(screen.queryByText(/click again to close/i)).toBeNull();
  });

  it('clicking the tab body still triggers onSelect (close click does not bubble)', () => {
    const { onSelect, onClose } = renderTabs({ activeId: 'other' });
    const closeBtn = screen.getByRole('button', { name: /close instance/i });
    fireEvent.click(closeBtn);
    // onSelect should NOT have been called from the close click — the handler
    // calls e.stopPropagation. This guards against a regression where Bug E's
    // close-button click stops bubbling correctly.
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
