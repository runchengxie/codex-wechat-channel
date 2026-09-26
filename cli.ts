#!/usr/bin/env node

import { runBridgeCtl } from "./scripts/bridgectl.js";
import { runProbe } from "./scripts/probe-app-server.js";
import { runServiceCtl } from "./scripts/servicectl.js";
import { runSetup } from "./src/setup.js";
import { runStart } from "./src/start.js";

type ParsedArgs = { _: string[]; [key: string]: string | boolean | string[] };

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const [key, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function stringArg(value: ParsedArgs[string] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function printHelp() {
  console.log(`
codex-wechat-channel

Usage:
  codex-wechat-channel setup [--base-url URL] [--force]
  codex-wechat-channel start [--cwd DIR] [--model MODEL] [--app-server-url WS_URL]
  codex-wechat-channel probe
  codex-wechat-channel bridge <start|status|stop> [--cwd DIR] [--model MODEL]
  codex-wechat-channel service <install|status|uninstall> [--cwd DIR] [--user USER] [--home DIR]
  codex-wechat-channel help

Environment:
  CODEX_BIN                         Codex executable path, default: codex
  CODEX_WECHAT_CWD                  Workspace for Codex threads, default: current dir
  CODEX_WECHAT_MODEL                Optional model override
  CODEX_WECHAT_SANDBOX              read-only | workspace-write | danger-full-access
  CODEX_WECHAT_APPROVAL_POLICY      default: never
  CODEX_WECHAT_APP_SERVER_URL       Reuse an existing Codex app-server websocket
  CODEX_WECHAT_BASE_URL             WeChat ilink API base URL
  CODEX_WECHAT_DEVELOPER_INSTRUCTIONS
                                    Extra instructions appended to each Codex thread
`);
}

const rawArgv = process.argv.slice(2);
const args = parseArgs(rawArgv);
const command = args._[0] ?? "help";

switch (command) {
  case "setup":
    await runSetup({
      baseUrl: stringArg(args["base-url"]),
      force: Boolean(args.force),
    });
    break;
  case "start":
    await runStart({
      cwd: stringArg(args.cwd),
      model: stringArg(args.model),
      appServerUrl: stringArg(args["app-server-url"]),
      baseUrl: stringArg(args["base-url"]),
      sandbox: stringArg(args.sandbox),
      approvalPolicy: stringArg(args["approval-policy"]),
    });
    break;
  case "probe":
    await runProbe();
    break;
  case "bridge":
    await runBridgeCtl(rawArgv.slice(1));
    break;
  case "service":
    await runServiceCtl(rawArgv.slice(1));
    break;
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
