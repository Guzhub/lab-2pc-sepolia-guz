#!/usr/bin/env node
// Audit — consulta a decisão de uma transação no CommitLog (Sepolia).
// Uso: npm run audit -- tx-1778814966637

require("dotenv").config();
const { ethers } = require("ethers");

const txId = process.argv[2];
if (!txId) {
  console.error("Uso: npm run audit -- <transactionId>");
  process.exit(1);
}

const ABI = [
  "function records(string) view returns (string transactionId, uint8 decision, uint256 timestamp, address coordinator, uint256 amount)",
];
const DECISION = { 0: "UNKNOWN", 1: "COMMIT", 2: "ABORT" };

(async () => {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, provider);
  const r = await contract.records(txId);

  const decision = DECISION[Number(r.decision)];
  if (decision === "UNKNOWN") {
    console.log(`Nenhuma decisão registrada para ${txId}.`);
    return;
  }

  const when = new Date(Number(r.timestamp) * 1000).toISOString().replace("T", " ").slice(0, 19);
  console.log("─── Auditoria on-chain ──────────────────────────────");
  console.log(`Transaction ID:  ${r.transactionId}`);
  console.log(`Decision:        ${decision}`);
  console.log(`Amount:          ${r.amount}`);
  console.log(`Timestamp:       ${when} UTC`);
  console.log(`Coordinator:     ${r.coordinator}`);
  console.log(`Contract:        ${process.env.CONTRACT_ADDRESS}`);
  console.log("─────────────────────────────────────────────────────");
})().catch((err) => {
  console.error("Erro consultando contrato:", err.message);
  process.exit(1);
});
