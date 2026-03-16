#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const args = process.argv.slice(2);
const CONFIG_FILE = "krypt.json";
const DEFAULT_BASE_URL =
  process.env.KRYPT_API_URL || "https://krypt-zeta-eight.vercel.app/api/v1";

function createPrompt() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function askQuestion(prompt, rl) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const [key, value] = arg.slice(2).split("=", 2);
    flags[key] = value ?? true;
  }

  return { flags, positional };
}

function printHelp() {
  console.log(`
Krypt CLI

Usage:
  krypt <command> [options]

Commands:
  init                      Save your environment token.
  info                      Show the project and environment bound to the token.
  pull [environment-name]   Pull secrets for the token's environment.

Options:
  --token=<token>           Override token from krypt.json.
  --output=<file>           Output file for pull. Defaults to .env.<environment>.
  --api-url=<url>           Override API base URL.
  --help                    Show this help message.

Examples:
  krypt init --token=krp_xxx
  krypt info
  krypt pull
  krypt pull --output=.env.local
`);
}

function readConfig() {
  const filePath = path.join(process.cwd(), CONFIG_FILE);

  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read ${CONFIG_FILE}: ${error.message}`);
  }
}

function writeConfig(config) {
  fs.writeFileSync(
    path.join(process.cwd(), CONFIG_FILE),
    JSON.stringify(config, null, 2),
  );
}

async function requestJson(baseUrl, endpoint, token) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const response = await fetch(`${normalizedBaseUrl}/${endpoint}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const payload = await response.json().catch(async () => {
    const raw = await response.text();
    throw new Error(`Unexpected response: ${raw}`);
  });

  if (!response.ok) {
    throw new Error(
      payload.error || `Request failed with status ${response.status}`,
    );
  }

  return payload;
}

function resolveToken(flags, config) {
  const token = typeof flags.token === "string" ? flags.token : config.token;

  if (!token || typeof token !== "string") {
    throw new Error("Missing token. Run `krypt init` or pass --token=<token>.");
  }

  return token.trim();
}

function resolveApiUrl(flags, config) {
  const apiUrl =
    (typeof flags["api-url"] === "string" && flags["api-url"]) ||
    config.apiUrl ||
    DEFAULT_BASE_URL;

  return apiUrl.replace(/\/+$/, "");
}

async function initCommand(flags) {
  let token = typeof flags.token === "string" ? flags.token.trim() : "";

  if (!token) {
    if (!process.stdin.isTTY) {
      throw new Error(
        "Interactive setup requires a terminal. Pass --token=<token>.",
      );
    }

    const rl = createPrompt();
    try {
      console.log("Krypt init");
      token = String(
        await askQuestion("Enter your environment token: ", rl),
      ).trim();
    } finally {
      rl.close();
    }
  }

  if (!token) {
    throw new Error("Token is required.");
  }

  writeConfig({
    token,
    apiUrl:
      (typeof flags["api-url"] === "string" && flags["api-url"]) ||
      DEFAULT_BASE_URL,
  });

  console.log(`Wrote ${CONFIG_FILE}.`);
  console.log("Run `krypt info` to verify the token scope.");
}

async function infoCommand(flags) {
  const config = readConfig();
  const token = resolveToken(flags, config);
  const apiUrl = resolveApiUrl(flags, config);
  const payload = await requestJson(apiUrl, "info", token);

  console.log("Krypt token scope");
  console.log(`User: ${payload.user}`);
  console.log(`Project: ${payload.project.name} (/${payload.project.slug})`);
  console.log(`Environment: ${payload.environment.name}`);
  console.log(`Scope: ${payload.tokenScope}`);
}

function formatEnvFile(payload) {
  const lines = [
    `# Pulled from Krypt (${payload.project} - ${payload.environment})`,
    `# Generated at: ${new Date().toISOString()}`,
    "",
  ];

  for (const [key, value] of Object.entries(payload.secrets)) {
    const normalizedValue =
      typeof value === "string" &&
      (value.includes(" ") || value.includes("\n") || value.includes('"'))
        ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
        : value;

    lines.push(`${key}=${normalizedValue}`);
  }

  lines.push("");
  return lines.join("\n");
}

async function pullCommand(positional, flags) {
  const config = readConfig();
  const token = resolveToken(flags, config);
  const apiUrl = resolveApiUrl(flags, config);
  const requestedEnvironment = positional[1];
  const info = await requestJson(apiUrl, "info", token);

  if (
    requestedEnvironment &&
    requestedEnvironment.toLowerCase() !== info.environment.name.toLowerCase()
  ) {
    throw new Error(
      `This token is scoped to '${info.environment.name}', not '${requestedEnvironment}'.`,
    );
  }

  const query = new URLSearchParams({
    envId: info.environment.id,
    projectId: info.project.id,
  });

  const payload = await requestJson(apiUrl, `pull?${query.toString()}`, token);
  const outputFile =
    typeof flags.output === "string" && flags.output
      ? flags.output
      : `.env.${payload.environment}`;

  fs.writeFileSync(
    path.join(process.cwd(), outputFile),
    formatEnvFile(payload),
  );

  console.log(`Wrote ${outputFile}`);
}

async function main() {
  const { positional, flags } = parseArgs(args);
  const command = positional[0];

  if (!command || flags.help || flags.h) {
    printHelp();
    return;
  }

  switch (command) {
    case "init":
      await initCommand(flags);
      return;
    case "info":
      await infoCommand(flags);
      return;
    case "pull":
      await pullCommand(positional, flags);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
