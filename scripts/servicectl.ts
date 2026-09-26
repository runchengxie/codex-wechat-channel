import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX,
  ensureDir,
} from "../src/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CLI_PATH = path.join(PROJECT_ROOT, "cli.js");
const WATCH_SCRIPT_PATH = path.join(PROJECT_ROOT, "scripts", "watch-codex-config.sh");
const DEFAULT_SERVICE_NAME = "codex-wechat-channel.service";
const DEFAULT_WATCH_SERVICE_NAME = "codex-wechat-channel-watch.service";

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function log(message: string) {
  process.stderr.write(`[servicectl] ${message}\n`);
}

function printUsage() {
  console.log(`Usage:
  codex-wechat-channel service install [--cwd DIR] [--user USER] [--home DIR] [--service-name NAME] [--watch-service-name NAME]
  codex-wechat-channel service status [--service-name NAME] [--watch-service-name NAME]
  codex-wechat-channel service uninstall [--service-name NAME] [--watch-service-name NAME]

Examples:
  sudo codex-wechat-channel service install --cwd /home/ubuntu
  sudo codex-wechat-channel service install --cwd /srv/repo --user ubuntu --home /home/ubuntu
  codex-wechat-channel service status
  sudo codex-wechat-channel service uninstall`);
}

function requireLinux() {
  if (process.platform !== "linux") {
    throw new Error("service install is only supported on Linux with systemd.");
  }
}

function quoteSystemdArg(value: string) {
  return `"${String(value).replace(/(["\\$`])/g, "\\$1")}"`;
}

function capture(command: string, args: string[], { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join("\n") ||
        `${command} ${args.join(" ")} failed with exit code ${result.status}`,
    );
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function run(command: string, args: string[], { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
  });

  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }

  return result.status ?? 1;
}

function commandExists(command: string) {
  const result = spawnSync(command, ["--help"], {
    stdio: "ignore",
  });
  return result.status === 0 || result.status === 1;
}

function isRootUser() {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

function getPrivilegePrefix() {
  if (isRootUser()) {
    return [];
  }

  if (!commandExists("sudo")) {
    throw new Error("sudo is required to install systemd units when not running as root.");
  }

  return ["sudo"];
}

function getSystemdPath(serviceName: string) {
  return path.posix.join("/etc/systemd/system", serviceName);
}

function getDataDirForHome(homeDir: string) {
  return path.join(homeDir, ".codex", "channels", "wechat");
}

function getBridgePidForHome(homeDir: string) {
  return path.join(getDataDirForHome(homeDir), "bridge.pid");
}

function resolveDefaultUser() {
  const sudoUser = process.env.SUDO_USER;
  if (sudoUser && sudoUser !== "root") {
    return sudoUser;
  }
  return os.userInfo().username;
}

function readPasswdHome(user: string) {
  if (commandExists("getent")) {
    const result = capture("getent", ["passwd", user], { allowFailure: true });
    const fields = result.stdout.trim().split(":");
    if (result.status === 0 && fields.length >= 6 && fields[5]) {
      return fields[5];
    }
  }

  try {
    const line = fs
      .readFileSync("/etc/passwd", "utf8")
      .split(/\r?\n/)
      .find((entry) => entry.startsWith(`${user}:`));
    if (!line) {
      return null;
    }
    const fields = line.split(":");
    return fields[5] || null;
  } catch {
    return null;
  }
}

function resolveHomeDirForUser(user: string) {
  if (user === os.userInfo().username) {
    return os.homedir();
  }

  const homeDir = readPasswdHome(user);
  if (!homeDir) {
    throw new Error(`failed to resolve home directory for ${user}; pass --home explicitly.`);
  }

  return homeDir;
}

function renderBridgeService({ user, cwd, homeDir }: { user: string; cwd: string; homeDir: string }) {
  const nodePath = process.execPath;
  const bridgePid = getBridgePidForHome(homeDir);

  return `[Unit]
Description=codex-wechat-channel background bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=forking
User=${user}
WorkingDirectory=${cwd}
Environment=HOME=${homeDir}
Environment=CODEX_WECHAT_SANDBOX=${DEFAULT_SANDBOX}
Environment=CODEX_WECHAT_APPROVAL_POLICY=${DEFAULT_APPROVAL_POLICY}
PIDFile=${bridgePid}
ExecStart=${quoteSystemdArg(nodePath)} ${quoteSystemdArg(CLI_PATH)} bridge start --cwd ${quoteSystemdArg(cwd)}
ExecStop=${quoteSystemdArg(nodePath)} ${quoteSystemdArg(CLI_PATH)} bridge stop
Restart=always
RestartSec=5
TimeoutStartSec=60
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
`;
}

function renderWatchService({ homeDir, serviceName }: { homeDir: string; serviceName: string }) {
  return `[Unit]
Description=Watch Codex MCP and skills recursively and restart ${serviceName}
After=network-online.target ${serviceName}
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/env bash ${quoteSystemdArg(WATCH_SCRIPT_PATH)} ${quoteSystemdArg(homeDir)} ${quoteSystemdArg(serviceName)}
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
`;
}

function ensureSystemd() {
  if (!commandExists("systemctl")) {
    throw new Error("systemctl is not available on this machine.");
  }
}

function ensureInotifyTools(prefix: string[]) {
  if (commandExists("inotifywait")) {
    return;
  }

  if (!commandExists("apt-get")) {
    throw new Error(
      "inotifywait is required. Install inotify-tools manually, then run the install command again.",
    );
  }

  log("installing inotify-tools via apt-get");
  run(prefix[0] || "apt-get", prefix.length ? [...prefix.slice(1), "apt-get", "update"] : ["update"]);
  run(
    prefix[0] || "apt-get",
    prefix.length ? [...prefix.slice(1), "apt-get", "install", "-y", "inotify-tools"] : ["install", "-y", "inotify-tools"],
  );
}

function writeFileAsRoot(prefix: string[], targetPath: string, content: string) {
  const tempFile = path.join(os.tmpdir(), `codex-wechat-${path.basename(targetPath)}-${Date.now()}`);
  fs.writeFileSync(tempFile, content, "utf8");
  try {
    if (prefix.length) {
      run(prefix[0], [...prefix.slice(1), "install", "-m", "0644", tempFile, targetPath]);
    } else {
      run("install", ["-m", "0644", tempFile, targetPath]);
    }
  } finally {
    fs.unlinkSync(tempFile);
  }
}

function removeFileAsRoot(prefix: string[], targetPath: string) {
  if (prefix.length) {
    run(prefix[0], [...prefix.slice(1), "rm", "-f", targetPath], { allowFailure: true });
    return;
  }
  run("rm", ["-f", targetPath], { allowFailure: true });
}

function runSystemctl(prefix: string[], args: string[], options: { allowFailure?: boolean } = {}) {
  if (prefix.length) {
    return run(prefix[0], [...prefix.slice(1), "systemctl", ...args], options);
  }
  return run("systemctl", args, options);
}

function captureSystemctl(prefix: string[], args: string[], options: { allowFailure?: boolean } = {}) {
  if (prefix.length) {
    return capture(prefix[0], [...prefix.slice(1), "systemctl", ...args], options);
  }
  return capture("systemctl", args, options);
}

function resolveOptions(argv: string[]) {
  const defaultUser = resolveDefaultUser();
  const options = {
    cwd: process.cwd(),
    serviceName: DEFAULT_SERVICE_NAME,
    watchServiceName: DEFAULT_WATCH_SERVICE_NAME,
    homeDir: resolveHomeDirForUser(defaultUser),
    user: defaultUser,
  };
  let homeExplicitlySet = false;
  let userExplicitlySet = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = token.slice(2).split("=", 2);
    const next = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) {
      index += 1;
    }

    switch (key) {
      case "cwd":
        options.cwd = next;
        break;
      case "service-name":
        options.serviceName = next.endsWith(".service") ? next : `${next}.service`;
        break;
      case "watch-service-name":
        options.watchServiceName = next.endsWith(".service") ? next : `${next}.service`;
        break;
      case "home":
        options.homeDir = next;
        homeExplicitlySet = true;
        break;
      case "user":
        options.user = next;
        userExplicitlySet = true;
        break;
      default:
        break;
    }
  }

  if (userExplicitlySet && !homeExplicitlySet) {
    options.homeDir = resolveHomeDirForUser(options.user);
  }

  options.cwd = path.resolve(options.cwd);
  options.homeDir = path.resolve(options.homeDir);
  return options;
}

async function installService(argv: string[]) {
  requireLinux();
  ensureSystemd();

  const options = resolveOptions(argv);
  ensureDir(getDataDirForHome(options.homeDir));
  const prefix = getPrivilegePrefix();
  ensureInotifyTools(prefix);

  const servicePath = getSystemdPath(options.serviceName);
  const watchServicePath = getSystemdPath(options.watchServiceName);

  writeFileAsRoot(prefix, servicePath, renderBridgeService(options));
  writeFileAsRoot(
    prefix,
    watchServicePath,
    renderWatchService({
      homeDir: options.homeDir,
      serviceName: options.serviceName,
    }),
  );

  const legacyPathUnit = getSystemdPath("codex-wechat-channel-restart.path");
  const legacyServiceUnit = getSystemdPath("codex-wechat-channel-restart.service");
  removeFileAsRoot(prefix, legacyPathUnit);
  removeFileAsRoot(prefix, legacyServiceUnit);

  runSystemctl(prefix, ["daemon-reload"]);
  runSystemctl(prefix, ["enable", options.serviceName, options.watchServiceName]);
  runSystemctl(prefix, ["restart", options.serviceName]);
  runSystemctl(prefix, ["restart", options.watchServiceName]);

  log(`installed ${servicePath}`);
  log(`installed ${watchServicePath}`);
  log(`service status: systemctl status ${options.serviceName}`);
  log(`watch status: systemctl status ${options.watchServiceName}`);
}

async function uninstallService(argv: string[]) {
  requireLinux();
  ensureSystemd();

  const options = resolveOptions(argv);
  const prefix = getPrivilegePrefix();
  const servicePath = getSystemdPath(options.serviceName);
  const watchServicePath = getSystemdPath(options.watchServiceName);

  runSystemctl(prefix, ["disable", "--now", options.watchServiceName], { allowFailure: true });
  runSystemctl(prefix, ["disable", "--now", options.serviceName], { allowFailure: true });
  removeFileAsRoot(prefix, watchServicePath);
  removeFileAsRoot(prefix, servicePath);
  runSystemctl(prefix, ["daemon-reload"]);

  log(`removed ${servicePath}`);
  log(`removed ${watchServicePath}`);
}

async function printStatus(argv: string[]) {
  requireLinux();
  ensureSystemd();

  const options = resolveOptions(argv);
  const bridge = captureSystemctl([], ["status", options.serviceName, "--no-pager", "-l"], {
    allowFailure: true,
  });
  const watch = captureSystemctl([], ["status", options.watchServiceName, "--no-pager", "-l"], {
    allowFailure: true,
  });

  process.stdout.write(bridge.stdout || bridge.stderr);
  process.stdout.write("\n");
  process.stdout.write(watch.stdout || watch.stderr);
}

export async function runServiceCtl(argv = process.argv.slice(2)) {
  const command = argv[0] ?? "status";
  const extraArgs = argv.slice(1);

  switch (command) {
    case "install":
      await installService(extraArgs);
      return;
    case "uninstall":
      await uninstallService(extraArgs);
      return;
    case "status":
      await printStatus(extraArgs);
      return;
    case "help":
    case "--help":
    case "-h":
      printUsage();
      return;
    default:
      printUsage();
      process.exit(1);
  }
}

if (isMainModule()) {
  await runServiceCtl();
}
