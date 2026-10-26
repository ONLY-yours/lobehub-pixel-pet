'use strict';

// Apps launched from Finder/Dock do not inherit the shell's PATH, so on macOS a
// packaged app cannot see an `lh` installed through Homebrew, nvm, fnm or volta,
// and `lh` itself (a `#!/usr/bin/env node` script) cannot see `node`. Locate
// both explicitly.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const realFs = {
  exists: (p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return fs.statSync(p).isFile() || fs.statSync(p).isSymbolicLink();
    } catch {
      return false;
    }
  },
  isDir: (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  readdir: (p) => {
    try {
      return fs.readdirSync(p);
    } catch {
      return [];
    }
  },
};

// Newest-first version directories, e.g. ~/.nvm/versions/node/v24.1.0
function versionDirs(root, suffix, io) {
  return io
    .readdir(root)
    .filter((n) => /^v?\d/.test(n))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((n) => path.join(root, n, suffix));
}

function candidateDirs({ home = os.homedir(), io = realFs } = {}) {
  const dirs = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.local/bin'),
    path.join(home, '.npm-global/bin'),
    path.join(home, '.volta/bin'),
    path.join(home, '.bun/bin'),
    path.join(home, '.asdf/shims'),
    ...versionDirs(path.join(home, '.nvm/versions/node'), 'bin', io),
    ...versionDirs(path.join(home, '.fnm/node-versions'), 'installation/bin', io),
    ...versionDirs(path.join(home, 'Library/Application Support/fnm/node-versions'), 'installation/bin', io),
    ...versionDirs(path.join(home, '.local/share/fnm/node-versions'), 'installation/bin', io),
    '/usr/bin',
  ];
  return dirs.filter((d) => io.isDir(d));
}

function loginShellLookup(env = process.env) {
  const shell = env.SHELL || '/bin/zsh';
  try {
    const out = execFileSync(shell, ['-ilc', 'command -v lh'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    const last = out.trim().split('\n').pop();
    return last && path.isAbsolute(last) ? last : null;
  } catch {
    return null;
  }
}

// Returns an absolute path to `lh`, or null. `lookup` is the login-shell fallback (injectable for tests).
function findLh({ env = process.env, home = os.homedir(), io = realFs, lookup = loginShellLookup } = {}) {
  if (env.LH_BIN) return env.LH_BIN;
  const dirs = [...(env.PATH || '').split(path.delimiter).filter(Boolean), ...candidateDirs({ home, io })];
  for (const d of dirs) {
    const p = path.join(d, 'lh');
    if (io.exists(p)) return p;
  }
  return process.platform === 'win32' ? null : lookup(env);
}

// PATH that lets `lh` find `node`: its own directory first (nvm/fnm/volta keep both together).
function withToolPath(env, lhPath, { home = os.homedir(), io = realFs } = {}) {
  const dirs = [];
  if (lhPath && path.isAbsolute(lhPath)) {
    const real = (() => { try { return fs.realpathSync(lhPath); } catch { return lhPath; } })();
    dirs.push(path.dirname(lhPath), path.dirname(real));
  }
  dirs.push(...candidateDirs({ home, io }), ...(env.PATH || '').split(path.delimiter).filter(Boolean));
  return { ...env, PATH: [...new Set(dirs)].join(path.delimiter) };
}

module.exports = { findLh, withToolPath, candidateDirs, realFs };
