require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const localPythonRoot = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python');
const candidates = [
  process.env.PYTHON_EXECUTABLE,
  path.join(localPythonRoot, 'Python313', 'python.exe'),
  path.join(localPythonRoot, 'Python312', 'python.exe'),
  path.join(localPythonRoot, 'Python311', 'python.exe'),
  process.platform === 'win32' ? 'py' : 'python3',
  'python3',
  'python'
].filter(Boolean);

const pythonExecutable = candidates.find(candidate => {
  if (path.isAbsolute(candidate) || candidate.includes(path.sep)) return fs.existsSync(candidate);
  const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
});

if (!pythonExecutable) {
  console.error('Python 3.11+ was not found. Set PYTHON_EXECUTABLE in .env to its executable path.');
  process.exit(1);
}

const backend = spawn(pythonExecutable, ['app.py'], {
  cwd: __dirname,
  env: process.env,
  stdio: 'inherit'
});

backend.on('error', error => {
  console.error(`Could not start the Python backend: ${error.message}`);
  process.exitCode = 1;
});

backend.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => backend.kill(signal));
}