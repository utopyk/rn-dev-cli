// Pure-data channel allowlist for `electron/preload.js`. Split out so vitest
// can import it without the `electron` runtime. Keep in sync with the
// renderer's actual usage.
//
// To audit the real usage:
//
//   rg "invoke\('" renderer/      → INVOKE_EXACT / INVOKE_PREFIX
//   rg "useIpcOn\('" renderer/     → ON_EXACT
//   rg "window\.rndev\.invoke\('" renderer/  → one-offs outside the hook

const INVOKE_EXACT = Object.freeze([
  // Profiles
  'profiles:list',
  'profiles:delete',
  'profiles:setDefault',

  // DevTools network proxy
  'devtools-network:proxy-port',
  'devtools-network:status',
  'devtools-network:restart',
  'devtools-network:select-target',

  // Wizard
  'wizard:createWorktree',
  'wizard:getWorktrees',
  'wizard:getBranches',
  'wizard:getDevices',
  'wizard:getPreflightChecks',
  'wizard:getTooling',
  'wizard:saveProfile',

  // Module-system panels + config
  'modules:activate-panel',
  'modules:set-panel-bounds',
  'modules:deactivate-panel',
  'modules:list-panels',
  'modules:list',
  'modules:config-get',
  'modules:config-set',

  // Open external (safe; opens editor via OS)
  'open:editor',

  // Instances
  'instances:list',
  'instances:getLogs',
  'instances:setActive',
  'instances:remove',
  'instances:create',
  'instance:retryStep',

  // Metro + runners + watcher + logs
  'metro:reload',
  'metro:devMenu',
  'run:lint',
  'run:typecheck',
  'run:clean',
  'watcher:toggle',
  'logs:dump',
]);

const INVOKE_PREFIX = Object.freeze([
  // Dynamic per-prompt response channels created in electron/ipc/services.ts
  'prompt:respond:',
]);

const ON_EXACT = Object.freeze([
  // Legacy + global logs
  'service:log',
  'metro:log',
  'build:line',

  // Per-instance stream events
  'instance:created',
  'instance:removed',
  'instance:log',
  'instance:metro',
  'instance:status',
  'instance:build:line',
  'instance:build:done',
  'instance:build:progress',
  'instance:prompt',
  'instance:section:start',
  'instance:section:end',

  // Module-system fan-out
  'modules:event',

  // DevTools network renderer subscription
  'devtools-network:change',
]);

function isAllowedInvoke(channel) {
  if (typeof channel !== 'string') return false;
  if (INVOKE_EXACT.includes(channel)) return true;
  return INVOKE_PREFIX.some(
    (p) => channel.startsWith(p) && channel.length > p.length,
  );
}

function isAllowedOn(channel) {
  return typeof channel === 'string' && ON_EXACT.includes(channel);
}

module.exports = {
  INVOKE_EXACT,
  INVOKE_PREFIX,
  ON_EXACT,
  isAllowedInvoke,
  isAllowedOn,
};
