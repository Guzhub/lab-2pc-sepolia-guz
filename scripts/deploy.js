#!/usr/bin/env node
// Deploy do CommitLog na Sepolia + atualização automática do CONTRACT_ADDRESS no .env.
// Roda: npm run deploy

require("dotenv").config();
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { SEPOLIA_RPC_URL, PRIVATE_KEY } = process.env;
if (!SEPOLIA_RPC_URL || !PRIVATE_KEY) {
  console.error("Faltam SEPOLIA_RPC_URL e/ou PRIVATE_KEY no .env");
  process.exit(1);
}

console.log("Compilando…");
execSync("forge build", { stdio: "inherit" });

console.log("\nDeployando CommitLog na Sepolia…");
const out = execSync(
  `forge script script/DeployCommitLog.s.sol:DeployCommitLog ` +
    `--rpc-url "${SEPOLIA_RPC_URL}" --private-key "${PRIVATE_KEY}" --broadcast`,
  { encoding: "utf8" }
);

// Forge devolve algo como: "0: contract CommitLog 0x68Ce..."
const match = out.match(/contract CommitLog\s+(0x[a-fA-F0-9]{40})/);
if (!match) {
  console.error("Não consegui parsear o endereço do contrato no output do forge:");
  console.error(out);
  process.exit(1);
}
const address = match[1];
console.log(`\nContrato deployado em: ${address}`);

// Atualiza o .env preservando as outras linhas.
const envPath = path.resolve(__dirname, "..", ".env");
const env = fs.readFileSync(envPath, "utf8");
const updated = env.match(/^CONTRACT_ADDRESS=/m)
  ? env.replace(/^CONTRACT_ADDRESS=.*$/m, `CONTRACT_ADDRESS=${address}`)
  : env.trimEnd() + `\nCONTRACT_ADDRESS=${address}\n`;
fs.writeFileSync(envPath, updated);
console.log("CONTRACT_ADDRESS atualizado no .env.");
