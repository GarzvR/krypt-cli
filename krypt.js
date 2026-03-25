#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const os = require("os");

const args = process.argv.slice(2);
const LOCAL_CONFIG_FILE = "krypt.json";
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".krypt");
const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, "config.json");

const DEFAULT_BASE_URL =
  process.env.KRYPT_API_URL || "https://krypt-zeta-eight.vercel.app/api/v1";

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  magenta: "\x1b[35m",
};

function createPrompt() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function askQuestion(prompt, rl) {
  return new Promise((resolve) => rl.question(`${c.bold}${prompt}${c.reset}`, resolve));
}

function askPassword(prompt, rl) {
  return new Promise((resolve) => {
    process.stdout.write(`${c.bold}${prompt}${c.reset}`);
    let password = "";
    
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (char) => {
      char = char.toString();
      switch (char) {
        case "\n":
        case "\r":
        case "\u0004":
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(password);
          break;
        case "\u0003": 
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write("\n");
          process.exit(0);
          break;
        case "\u0008": 
        case "\u007f":
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write("\b \b");
          }
          break;
        default:
          password += char;
          process.stdout.write("*");
          break;
      }
    };

    stdin.on("data", onData);
  });
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
${c.magenta}${c.bold}Krypt CLI${c.reset} ${c.gray}v1.0.0${c.reset}

${c.bold}Usage:${c.reset}
  krypt <command> [options]

${c.bold}Commands:${c.reset}
  ${c.cyan}login${c.reset}                     Log in with your email and password
  ${c.cyan}link${c.reset}                      Link directory to a project and environment
  ${c.cyan}info${c.reset}                      Show linked project and auth status
  ${c.cyan}pull${c.reset}                      Pull secrets to .env file
  ${c.cyan}logout${c.reset}                    Clear global authentication token

${c.bold}Options:${c.reset}
  ${c.yellow}--token=<token>${c.reset}           Override auth token
  ${c.yellow}--output=<file>${c.reset}           Output file for pull
  ${c.yellow}--api-url=<url>${c.reset}           Override API base URL
  ${c.yellow}--help${c.reset}                    Show this help message

${c.bold}Examples:${c.reset}
  krypt login
  krypt link
  krypt pull
`);
}

function readLocalConfig() {
  if (!fs.existsSync(LOCAL_CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(LOCAL_CONFIG_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

function writeLocalConfig(config) {
  fs.writeFileSync(LOCAL_CONFIG_FILE, JSON.stringify(config, null, 2));
}

function readGlobalConfig() {
  if (!fs.existsSync(GLOBAL_CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

function writeGlobalConfig(config) {
  if (!fs.existsSync(GLOBAL_CONFIG_DIR)) {
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function requestJson(baseUrl, endpoint, token, method = "GET", body = null) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const options = {
    method,
    headers: {
      Accept: "application/json",
    },
  };

  if (token) {
    options.headers.Authorization = `Bearer ${token}`;
  }

  if (body) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${normalizedBaseUrl}/${endpoint}`, options);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || `Request failed (${response.status})`);
    }

    return payload;
  } catch (error) {
    if (error.name === 'TypeError' && error.message === 'fetch failed') {
        throw new Error("Connection failed. Check your internet or API URL.");
    }
    throw error;
  }
}

function resolveToken(flags) {
  if (typeof flags.token === "string") return flags.token.trim();
  const global = readGlobalConfig();
  if (global.token) return global.token;
  throw new Error(`Not logged in. Run ${c.cyan}'krypt login'${c.reset} first.`);
}

function resolveApiUrl(flags) {
  return (typeof flags["api-url"] === "string" ? flags["api-url"] : DEFAULT_BASE_URL).replace(/\/+$/, "");
}

async function loginCommand(flags) {
  const apiUrl = resolveApiUrl(flags);
  const rl = createPrompt();
  
  try {
    console.log(`${c.magenta}${c.bold}Krypt Login${c.reset}`);
    const email = await askQuestion("Email: ", rl);
    const password = await askPassword("Password: ", rl);
    
    process.stdout.write(`\n${c.gray}Authenticating...${c.reset} `);
    const payload = await requestJson(apiUrl, "auth/login", null, "POST", { email, password });
    
    writeGlobalConfig({
      token: payload.token,
      email: payload.user.email,
      apiUrl
    });
    
    console.log(`${c.green}✓${c.reset} Successfully logged in as ${c.bold}${payload.user.email}${c.reset}`);
  } finally {
    rl.close();
  }
}

async function logoutCommand() {
  if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
    fs.unlinkSync(GLOBAL_CONFIG_FILE);
    console.log(`${c.green}✓${c.reset} Logged out successfully.`);
  } else {
    console.log(`${c.gray}No active session found.${c.reset}`);
  }
}

async function linkCommand(flags) {
  const apiUrl = resolveApiUrl(flags);
  const token = resolveToken(flags);
  const rl = createPrompt();

  try {
    process.stdout.write(`${c.gray}Fetching projects...${c.reset} `);
    const { projects } = await requestJson(apiUrl, "projects", token);
    console.log(`${c.green}done${c.reset}`);

    if (projects.length === 0) {
      console.log(`${c.yellow}!${c.reset} No projects found in your account.`);
      return;
    }

    console.log(`\n${c.bold}Select a project:${c.reset}`);
    projects.forEach((p, i) => {
      console.log(`  ${c.cyan}[${i + 1}]${c.reset} ${p.name} ${c.gray}(${p.slug})${c.reset}`);
    });

    const projectIndex = parseInt(await askQuestion("\nEnter selection number: ", rl)) - 1;
    if (isNaN(projectIndex) || !projects[projectIndex]) {
      throw new Error("Invalid selection.");
    }

    const selectedProject = projects[projectIndex];
    console.log(`${c.green}✓${c.reset} Selected: ${c.bold}${selectedProject.name}${c.reset}`);

    process.stdout.write(`\n${c.gray}Fetching environments...${c.reset} `);
    const { environments } = await requestJson(apiUrl, `projects/${selectedProject.id}/environments`, token);
    console.log(`${c.green}done${c.reset}`);

    if (environments.length === 0) {
      console.log(`${c.yellow}!${c.reset} No environments found in this project.`);
      return;
    }

    console.log(`\n${c.bold}Select an environment:${c.reset}`);
    environments.forEach((e, i) => {
      console.log(`  ${c.cyan}[${i + 1}]${c.reset} ${e.name}`);
    });

    const envIndex = parseInt(await askQuestion("\nEnter selection number: ", rl)) - 1;
    if (isNaN(envIndex) || !environments[envIndex]) {
      throw new Error("Invalid selection.");
    }

    const selectedEnv = environments[envIndex];
    
    writeLocalConfig({
      projectId: selectedProject.id,
      projectName: selectedProject.name,
      projectSlug: selectedProject.slug,
      environmentId: selectedEnv.id,
      environmentName: selectedEnv.name
    });

    console.log(`\n${c.green}✓${c.reset} Linked to ${c.bold}${selectedProject.name}${c.reset} → ${c.bold}${selectedEnv.name}${c.reset}`);
  } finally {
    rl.close();
  }
}

async function infoCommand(flags) {
  const global = readGlobalConfig();
  const local = readLocalConfig();

  console.log(`${c.magenta}${c.bold}Krypt CLI Info${c.reset}`);
  console.log(`${c.bold}User:${c.reset}       ${global.email || c.gray + "Not logged in" + c.reset}`);
  console.log(`${c.bold}API URL:${c.reset}    ${global.apiUrl || DEFAULT_BASE_URL}`);
  
  if (local.projectId) {
    console.log(`\n${c.bold}Current Link:${c.reset}`);
    console.log(`  Project:     ${c.cyan}${local.projectName}${c.reset} ${c.gray}(${local.projectSlug})${c.reset}`);
    console.log(`  Environment: ${c.cyan}${local.environmentName}${c.reset}`);
  } else {
    console.log(`\n${c.gray}No project linked in this directory. Run${c.reset} ${c.cyan}'krypt link'${c.reset}${c.gray}.${c.reset}`);
  }
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
  const apiUrl = resolveApiUrl(flags);
  const token = resolveToken(flags);
  const local = readLocalConfig();

  if (!local.projectId || !local.environmentId) {
    throw new Error(`Directory not linked. Run ${c.cyan}'krypt link'${c.reset} first.`);
  }

  process.stdout.write(`${c.gray}Pulling secrets...${c.reset} `);
  
  const query = new URLSearchParams({
    projectId: local.projectId,
    envId: local.environmentId,
  });

  const payload = await requestJson(apiUrl, `pull?${query.toString()}`, token);
  
  const outputFile =
    typeof flags.output === "string" && flags.output
      ? flags.output
      : `.env.${payload.environment.toLowerCase()}`;

  fs.writeFileSync(path.join(process.cwd(), outputFile), formatEnvFile(payload));

  console.log(`${c.green}done${c.reset}`);
  console.log(`${c.green}✓${c.reset} Wrote ${c.bold}${outputFile}${c.reset}`);
}

async function main() {
  const { positional, flags } = parseArgs(args);
  const command = positional[0];

  if (!command || flags.help || flags.h) {
    printHelp();
    return;
  }

  try {
    switch (command) {
      case "login":
        await loginCommand(flags);
        break;
      case "logout":
        await logoutCommand();
        break;
      case "link":
        await linkCommand(flags);
        break;
      case "info":
        await infoCommand(flags);
        break;
      case "pull":
        await pullCommand(positional, flags);
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.error(`\n${c.red}Error:${c.reset} ${error.message}`);
    process.exit(1);
  }
}

main();
