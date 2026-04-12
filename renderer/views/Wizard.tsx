import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SearchableList } from '../components/SearchableList';
import { useIpcInvoke } from '../hooks/useIpc';
import './Wizard.css';

// ── Types ──

interface WorktreeOption {
  name: string;
  path: string;
  branch: string;
  isMain: boolean;
}

interface DeviceOption {
  id: string;
  name: string;
  type: string;
  status: string;
  runtime?: string;
}

interface PreflightCheck {
  id: string;
  label: string;
  platform: string;
}

interface ToolingOption {
  tool: string;
  command: string;
}

type Platform = 'ios' | 'android' | 'both';
type Mode = 'dirty' | 'clean' | 'ultra-clean';
type PreflightFrequency = 'once' | 'always';

interface WizardState {
  worktree: WorktreeOption | null;
  branch: string | null;
  platform: Platform;
  mode: Mode;
  device: DeviceOption | null;
  preflightChecks: string[];
  preflightFrequency: PreflightFrequency;
  onSaveTools: string[];
  customCommand: string;
}

interface WizardProps {
  onComplete: () => void;
  onCancel: () => void;
}

const TOTAL_STEPS = 7;

const MODE_DESCRIPTIONS: Record<Mode, string> = {
  dirty: 'Skip clean steps, fastest startup. Use for normal development.',
  clean: 'Clean build artifacts and caches before building.',
  'ultra-clean': 'Nuke node_modules, pods, and all caches. Full fresh start.',
};

// ── Wizard Component ──

export function Wizard({ onComplete, onCancel }: WizardProps) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const invoke = useIpcInvoke();

  // Cached data from IPC
  const [worktrees, setWorktrees] = useState<WorktreeOption[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[]>([]);
  const [tooling, setTooling] = useState<ToolingOption[]>([]);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  // Wizard selections
  const [state, setState] = useState<WizardState>({
    worktree: null,
    branch: null,
    platform: 'ios',
    mode: 'dirty',
    device: null,
    preflightChecks: [],
    preflightFrequency: 'once',
    onSaveTools: [],
    customCommand: '',
  });

  // Load data per step
  useEffect(() => {
    if (step === 1 && worktrees.length === 0) {
      setLoadingKey('worktrees');
      invoke('wizard:getWorktrees').then((data: WorktreeOption[]) => {
        setWorktrees(data ?? []);
        setLoadingKey(null);
      });
    }
  }, [step]);

  useEffect(() => {
    if (step === 2 && branches.length === 0) {
      setLoadingKey('branches');
      invoke('wizard:getBranches').then((data: string[]) => {
        setBranches(data ?? []);
        setLoadingKey(null);
      });
    }
  }, [step]);

  useEffect(() => {
    if (step === 5) {
      setLoadingKey('devices');
      invoke('wizard:getDevices', state.platform).then((data: DeviceOption[]) => {
        setDevices(data ?? []);
        setLoadingKey(null);
      });
    }
  }, [step, state.platform]);

  useEffect(() => {
    if (step === 6 && preflightChecks.length === 0) {
      invoke('wizard:getPreflightChecks').then((data: PreflightCheck[]) => {
        const checks = data ?? [];
        setPreflightChecks(checks);
        // Pre-select all relevant checks
        const relevant = checks
          .filter((c) => c.platform === 'all' || c.platform === state.platform)
          .map((c) => c.id);
        setState((s) => ({ ...s, preflightChecks: relevant }));
      });
    }
  }, [step]);

  useEffect(() => {
    if (step === 7 && tooling.length === 0) {
      setLoadingKey('tooling');
      invoke('wizard:getTooling').then((data: ToolingOption[]) => {
        setTooling(data ?? []);
        setLoadingKey(null);
      });
    }
  }, [step]);

  // Navigation
  const canGoNext = useCallback((): boolean => {
    switch (step) {
      case 1: return state.worktree !== null;
      case 2: return state.branch !== null;
      case 3: return true;
      case 4: return true;
      case 5: return true; // device is optional
      case 6: return true;
      case 7: return true;
      default: return false;
    }
  }, [step, state]);

  const goNext = () => {
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    } else {
      handleFinish();
    }
  };

  const goBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleFinish = async () => {
    setSaving(true);
    const profileData = {
      name: `profile-${Date.now()}`,
      isDefault: true,
      worktree: state.worktree?.path ?? null,
      branch: state.branch ?? 'main',
      platform: state.platform,
      mode: state.mode,
      metroPort: 8081,
      devices: {
        ios: state.platform !== 'android' && state.device ? state.device.id : null,
        android: state.platform !== 'ios' && state.device ? state.device.id : null,
      },
      buildVariant: 'debug',
      preflight: {
        checks: state.preflightChecks,
        frequency: state.preflightFrequency,
      },
      onSave: [
        ...state.onSaveTools,
        ...(state.customCommand.trim() ? [state.customCommand.trim()] : []),
      ],
      env: {},
    };

    await invoke('wizard:saveProfile', profileData);
    setSaving(false);
    onComplete();
  };

  // Toggle helpers
  const togglePreflightCheck = (id: string) => {
    setState((s) => ({
      ...s,
      preflightChecks: s.preflightChecks.includes(id)
        ? s.preflightChecks.filter((c) => c !== id)
        : [...s.preflightChecks, id],
    }));
  };

  const toggleOnSaveTool = (tool: string) => {
    setState((s) => ({
      ...s,
      onSaveTools: s.onSaveTools.includes(tool)
        ? s.onSaveTools.filter((t) => t !== tool)
        : [...s.onSaveTools, tool],
    }));
  };

  // ── Summary chips ──
  const summaryItems: { label: string; value: string }[] = [];
  if (state.worktree) summaryItems.push({ label: 'Worktree', value: state.worktree.name });
  if (state.branch) summaryItems.push({ label: 'Branch', value: state.branch });
  if (step > 3) summaryItems.push({ label: 'Platform', value: state.platform });
  if (step > 4) summaryItems.push({ label: 'Mode', value: state.mode });
  if (state.device && step > 5) summaryItems.push({ label: 'Device', value: state.device.name });

  // ── Render step content ──
  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <StepContainer
            title="Select Worktree"
            subtitle="Choose the git worktree for this profile."
          >
            <SearchableList<WorktreeOption>
              items={worktrees}
              labelKey="name"
              searchKeys={['name', 'branch', 'path']}
              onSelect={(wt) => {
                setState((s) => ({ ...s, worktree: wt }));
                goNext();
              }}
              placeholder="Search worktrees..."
              loading={loadingKey === 'worktrees'}
              renderItem={(wt, isActive) => (
                <>
                  <span className="sl-item-label">
                    {wt.isMain ? '* ' : ''}{wt.name}
                  </span>
                  <span className="sl-item-meta">{wt.branch}</span>
                </>
              )}
            />
          </StepContainer>
        );

      case 2: {
        const branchItems = branches.map((b) => ({ name: b }));
        return (
          <StepContainer
            title="Select Branch"
            subtitle="Choose the branch to work on."
          >
            <SearchableList<{ name: string }>
              items={branchItems}
              labelKey="name"
              searchKeys={['name']}
              onSelect={(b) => {
                setState((s) => ({ ...s, branch: b.name }));
                goNext();
              }}
              placeholder="Search branches..."
              loading={loadingKey === 'branches'}
            />
          </StepContainer>
        );
      }

      case 3:
        return (
          <StepContainer
            title="Platform"
            subtitle="Which platform are you targeting?"
          >
            <RadioGroup
              options={[
                { value: 'ios', label: 'iOS' },
                { value: 'android', label: 'Android' },
                { value: 'both', label: 'Both' },
              ]}
              value={state.platform}
              onChange={(v) => setState((s) => ({ ...s, platform: v as Platform, device: null }))}
            />
          </StepContainer>
        );

      case 4:
        return (
          <StepContainer
            title="Build Mode"
            subtitle="How aggressively should we clean before building?"
          >
            <RadioGroup
              options={[
                { value: 'dirty', label: 'Dirty', description: MODE_DESCRIPTIONS['dirty'] },
                { value: 'clean', label: 'Clean', description: MODE_DESCRIPTIONS['clean'] },
                { value: 'ultra-clean', label: 'Ultra-Clean', description: MODE_DESCRIPTIONS['ultra-clean'] },
              ]}
              value={state.mode}
              onChange={(v) => setState((s) => ({ ...s, mode: v as Mode }))}
            />
          </StepContainer>
        );

      case 5:
        return (
          <StepContainer
            title="Device"
            subtitle="Select a simulator or device to run on."
          >
            <SearchableList<DeviceOption>
              items={devices}
              labelKey="name"
              searchKeys={['name', 'runtime']}
              onSelect={(d) => {
                setState((s) => ({ ...s, device: d }));
                goNext();
              }}
              placeholder="Search devices..."
              loading={loadingKey === 'devices'}
              renderItem={(d, isActive) => (
                <>
                  <span className={`sl-device-dot ${d.status}`} />
                  <span className="sl-item-label">{d.name}</span>
                  <span className="sl-item-meta">{d.runtime ?? d.type}</span>
                </>
              )}
            />
          </StepContainer>
        );

      case 6: {
        const relevantChecks = preflightChecks.filter(
          (c) => c.platform === 'all' || c.platform === state.platform
        );
        return (
          <StepContainer
            title="Preflight Checks"
            subtitle="Select checks to run before starting services."
          >
            <div className="wz-checkbox-group">
              {relevantChecks.map((check) => (
                <label key={check.id} className="wz-checkbox">
                  <input
                    type="checkbox"
                    checked={state.preflightChecks.includes(check.id)}
                    onChange={() => togglePreflightCheck(check.id)}
                  />
                  <span className="wz-checkbox-mark" />
                  <span className="wz-checkbox-label">{check.label}</span>
                </label>
              ))}
            </div>
            <div className="wz-frequency">
              <span className="wz-frequency-label">Run preflight:</span>
              <RadioGroup
                options={[
                  { value: 'once', label: 'Run once' },
                  { value: 'always', label: 'Every time' },
                ]}
                value={state.preflightFrequency}
                onChange={(v) =>
                  setState((s) => ({ ...s, preflightFrequency: v as PreflightFrequency }))
                }
                inline
              />
            </div>
          </StepContainer>
        );
      }

      case 7:
        return (
          <StepContainer
            title="On-Save Actions"
            subtitle="Run these commands whenever a file is saved."
          >
            <div className="wz-checkbox-group">
              {tooling.map((t) => (
                <label key={t.tool} className="wz-checkbox">
                  <input
                    type="checkbox"
                    checked={state.onSaveTools.includes(t.command)}
                    onChange={() => toggleOnSaveTool(t.command)}
                  />
                  <span className="wz-checkbox-mark" />
                  <span className="wz-checkbox-label">{t.tool}</span>
                  <span className="wz-checkbox-meta">{t.command}</span>
                </label>
              ))}
              {tooling.length === 0 && loadingKey !== 'tooling' && (
                <div className="wz-empty-msg">No tooling detected in project.</div>
              )}
              {loadingKey === 'tooling' && (
                <div className="wz-empty-msg">Detecting tooling...</div>
              )}
            </div>
            <div className="wz-custom-cmd">
              <label className="wz-custom-cmd-label">Add custom command</label>
              <input
                className="wz-custom-cmd-input"
                type="text"
                value={state.customCommand}
                onChange={(e) => setState((s) => ({ ...s, customCommand: e.target.value }))}
                placeholder="e.g. npx eslint --fix ."
              />
            </div>
          </StepContainer>
        );
    }
  };

  return (
    <div className="wizard-root">
      <div className="wizard-container">
        {/* Header */}
        <div className="wizard-header">
          <h1 className="wizard-title">Setup Profile</h1>
          <StepIndicator current={step} total={TOTAL_STEPS} />
        </div>

        {/* Summary bar */}
        {summaryItems.length > 0 && (
          <div className="wizard-summary">
            {summaryItems.map((item) => (
              <span key={item.label} className="summary-chip">
                <span className="summary-chip-label">{item.label}:</span>
                <span className="summary-chip-value">{item.value}</span>
              </span>
            ))}
          </div>
        )}

        {/* Step content */}
        <div className="wizard-body">
          {renderStep()}
        </div>

        {/* Footer */}
        <div className="wizard-footer">
          <button className="wz-btn wz-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <div className="wizard-footer-right">
            {step > 1 && (
              <button className="wz-btn wz-btn-secondary" onClick={goBack}>
                Back
              </button>
            )}
            <button
              className="wz-btn wz-btn-primary"
              onClick={goNext}
              disabled={!canGoNext() || saving}
            >
              {saving ? 'Saving...' : step === TOTAL_STEPS ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──

function StepContainer({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="wz-step">
      <h2 className="wz-step-title">{title}</h2>
      <p className="wz-step-subtitle">{subtitle}</p>
      <div className="wz-step-content">{children}</div>
    </div>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="step-indicator">
      {Array.from({ length: total }, (_, i) => {
        const num = i + 1;
        let cls = 'step-dot';
        if (num === current) cls += ' active';
        else if (num < current) cls += ' done';
        return (
          <div key={num} className={cls}>
            {num}
          </div>
        );
      })}
    </div>
  );
}

interface RadioOption {
  value: string;
  label: string;
  description?: string;
}

function RadioGroup({
  options,
  value,
  onChange,
  inline,
}: {
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  inline?: boolean;
}) {
  return (
    <div className={`wz-radio-group${inline ? ' inline' : ''}`}>
      {options.map((opt) => (
        <label
          key={opt.value}
          className={`wz-radio${value === opt.value ? ' selected' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          <span className="wz-radio-circle">
            {value === opt.value && <span className="wz-radio-dot" />}
          </span>
          <span className="wz-radio-content">
            <span className="wz-radio-label">{opt.label}</span>
            {opt.description && (
              <span className="wz-radio-desc">{opt.description}</span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}
