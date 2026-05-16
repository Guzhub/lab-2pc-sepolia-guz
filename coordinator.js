// Coordenador 2PC + Sepolia.
//
// Mudanças em relação ao lab original:
//   1. Passa `amount` no recordDecision (campo novo do contrato).
//   2. Aceita flags --scenario e --slow para tornar a execução roteirizável.
//   3. Cenário "crash": coordenador morre depois de gravar a decisão on-chain,
//      mas antes de notificar os bancos — usado para demonstrar o recovery
//      via blockchain (ver participant.js).

require("dotenv").config();
const net = require("net");
const { ethers } = require("ethers");

// ─── Parse de argumentos ────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const scenario = args.scenario || "happy";
const slowMs = args.fast ? 0 : Number(args.slow ?? 0);

const SCENARIOS = {
  happy: { amount: 50, crashAfterRecord: false },
  abort: { amount: 150, crashAfterRecord: false }, // > saldo de A → vota NO
  crash: { amount: 50, crashAfterRecord: true },   // testa recovery dos bancos
};
if (!SCENARIOS[scenario]) {
  console.error(`Cenário desconhecido: ${scenario}. Use: happy | abort | crash`);
  process.exit(1);
}
const { amount, crashAfterRecord } = SCENARIOS[scenario];

// ─── Setup ──────────────────────────────────────────────────────────────────
const participants = [
  { name: "Banco A", host: "127.0.0.1", port: 5001 },
  { name: "Banco B", host: "127.0.0.1", port: 5002 },
];

const ABI = [
  "function recordDecision(string transactionId, uint8 decision, uint256 amount) public",
  "function getDecision(string transactionId) public view returns (uint8)",
];

const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, wallet);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sendMessage(participant, message) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket();
    client.connect(participant.port, participant.host, () => {
      client.write(JSON.stringify(message));
    });
    client.on("data", (data) => {
      resolve(JSON.parse(data.toString()));
      client.destroy();
    });
    client.on("error", reject);
  });
}

// ─── 2PC ────────────────────────────────────────────────────────────────────
async function run2PC() {
  const transactionId = `tx-${Date.now()}`;

  console.log(`\n=== Cenário: ${scenario.toUpperCase()} ===`);
  console.log(`Transação ${transactionId} | Banco A → Banco B | Valor: ${amount}`);
  if (crashAfterRecord) {
    console.log("(coordenador irá crashar após gravar a decisão on-chain)");
  }
  await sleep(slowMs);

  // Fase 1 — PREPARE + coleta de votos.
  console.log("\n[Coordenador] Fase 1: PREPARE");
  const votes = [];
  for (const p of participants) {
    const response = await sendMessage(p, { type: "PREPARE", transactionId, amount });
    console.log(`[Coordenador] Voto de ${p.name}: ${response.vote}`);
    votes.push(response.vote);
    await sleep(slowMs);
  }

  // Decisão.
  const decision = votes.every((v) => v === "YES") ? "COMMIT" : "ABORT";
  console.log(`\n[Coordenador] Decisão final: ${decision}`);
  await sleep(slowMs);

  // Registro on-chain ANTES da Fase 2.
  // Esta ordem é deliberada: se o coordenador morrer depois daqui, os bancos
  // ainda conseguem descobrir a decisão consultando o contrato.
  const blockchainDecision = decision === "COMMIT" ? 1 : 2;
  console.log("[Coordenador] Registrando decisão na Sepolia…");
  const tx = await contract.recordDecision(transactionId, blockchainDecision, amount);
  await tx.wait();
  console.log(`[Coordenador] Decisão registrada. Hash: ${tx.hash}`);
  await sleep(slowMs);

  // Crash simulado: morre antes de notificar os bancos.
  if (crashAfterRecord) {
    console.log("\n[Coordenador] CRASH simulado — bancos terão que se virar via blockchain.\n");
    process.exit(0);
  }

  // Fase 2 — broadcast da decisão.
  console.log(`\n[Coordenador] Fase 2: broadcast ${decision}`);
  for (const p of participants) {
    await sendMessage(p, { type: decision, transactionId, amount });
    await sleep(slowMs);
  }
  console.log(`\n[Coordenador] Concluído. transactionId=${transactionId}`);
}

run2PC().catch((err) => {
  console.error("Erro fatal no coordenador:", err);
  process.exit(1);
});
