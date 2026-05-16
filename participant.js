// Participant — lógica compartilhada de Banco A e Banco B.
//
// Diferença em relação ao lab original:
//   1. Após votar YES, o banco fica em estado "uncertain" e arma um timer.
//   2. Se o coordenador não confirmar (COMMIT/ABORT) dentro do timeout,
//      o banco consulta o CommitLog na Sepolia para descobrir a decisão
//      sozinho — recovery sem coordenador.
//
// Esse é o ponto central da extensão: a blockchain deixa de ser apenas
// trilha de auditoria e passa a funcionar como oráculo de decisão,
// resolvendo o problema clássico do 2PC bloqueante.

require("dotenv").config();
const net = require("net");
const { ethers } = require("ethers");

const READ_ONLY_ABI = [
  "function getDecision(string) view returns (uint8)",
];

const DECISION_NAMES = { 0: "UNKNOWN", 1: "COMMIT", 2: "ABORT" };

function makeContract() {
  // Para recovery basta um provider read-only — banco nunca escreve on-chain.
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  return new ethers.Contract(process.env.CONTRACT_ADDRESS, READ_ONLY_ABI, provider);
}

/**
 * @param {object} cfg
 * @param {string} cfg.name              — rótulo nos logs ("Banco A")
 * @param {number} cfg.port              — porta TCP
 * @param {number} cfg.initialBalance    — saldo inicial
 * @param {(amount,balance)=>boolean} cfg.canAccept — política de voto (PREPARE)
 * @param {(amount,balance)=>number} cfg.applyCommit — efeito do COMMIT no saldo
 * @param {number} [cfg.recoveryTimeoutMs=8000] — quanto esperar pelo coordenador
 * @param {number} [cfg.recoveryRetries=3]      — tentativas extra antes de presumed-abort
 */
function startParticipant(cfg) {
  const recoveryTimeoutMs = cfg.recoveryTimeoutMs ?? 8000;
  const recoveryRetries = cfg.recoveryRetries ?? 3;
  const contract = makeContract();

  let balance = cfg.initialBalance;
  // Transações em estado "uncertain": votou YES, ainda não sabe se commita.
  // Mapa de txId -> { amount, timer, attempts }
  const pending = new Map();

  function log(...args) {
    console.log(`[${cfg.name}]`, ...args);
  }

  function applyCommit(txId, amount) {
    balance = cfg.applyCommit(amount, balance);
    log(`COMMIT ${txId}. Novo saldo: ${balance}`);
  }

  function applyAbort(txId) {
    log(`ABORT ${txId}. Nenhuma alteração feita.`);
  }

  // Recovery: quando o coordenador some, consulta o contrato.
  async function recover(txId) {
    const entry = pending.get(txId);
    if (!entry) return; // já resolvido por mensagem direta
    entry.attempts++;

    log(`Timeout aguardando coordenador para ${txId}. Consultando blockchain…`);
    let decision;
    try {
      decision = Number(await contract.getDecision(txId));
    } catch (err) {
      log(`Erro consultando contrato: ${err.message}. Retry em ${recoveryTimeoutMs}ms`);
      entry.timer = setTimeout(() => recover(txId), recoveryTimeoutMs);
      return;
    }

    log(`Blockchain respondeu: ${DECISION_NAMES[decision]}`);

    if (decision === 1) {
      applyCommit(txId, entry.amount);
      pending.delete(txId);
    } else if (decision === 2) {
      applyAbort(txId);
      pending.delete(txId);
    } else {
      // UNKNOWN: coordenador pode estar atrasado, ou morreu antes de gravar.
      // Decisão: continuar esperando até esgotar tentativas. Depois disso,
      // adotar "presumed abort" — única escolha segura porque, sem registro
      // on-chain, o coordenador também não pode mais commitar (o require
      // do contrato impede registros duplicados, mas aqui o problema é o
      // inverso: registro nunca chegou). Em produção, esse limite deveria
      // ser maior; para o lab, 3 tentativas bastam para demonstrar o ponto.
      if (entry.attempts >= recoveryRetries) {
        log(`Decisão UNKNOWN após ${entry.attempts} tentativas — presumed abort.`);
        applyAbort(txId);
        pending.delete(txId);
      } else {
        log(`Decisão ainda UNKNOWN. Retentativa ${entry.attempts}/${recoveryRetries} em ${recoveryTimeoutMs}ms`);
        entry.timer = setTimeout(() => recover(txId), recoveryTimeoutMs);
      }
    }
  }

  const server = net.createServer((socket) => {
    socket.on("data", (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === "PREPARE") {
        log(`PREPARE recebido (${msg.transactionId}, valor ${msg.amount})`);
        const vote = cfg.canAccept(msg.amount, balance) ? "YES" : "NO";
        socket.write(JSON.stringify({ vote }));

        // Se votou YES, entra em estado uncertain e arma timer de recovery.
        if (vote === "YES") {
          const timer = setTimeout(() => recover(msg.transactionId), recoveryTimeoutMs);
          pending.set(msg.transactionId, {
            amount: msg.amount,
            timer,
            attempts: 0,
          });
        }
      }

      if (msg.type === "COMMIT") {
        // Cancela recovery timer (coordenador veio antes do timeout).
        const entry = pending.get(msg.transactionId);
        if (entry) clearTimeout(entry.timer);
        pending.delete(msg.transactionId);

        applyCommit(msg.transactionId, msg.amount);
        socket.write(JSON.stringify({ status: "OK" }));
      }

      if (msg.type === "ABORT") {
        const entry = pending.get(msg.transactionId);
        if (entry) clearTimeout(entry.timer);
        pending.delete(msg.transactionId);

        applyAbort(msg.transactionId);
        socket.write(JSON.stringify({ status: "OK" }));
      }
    });
  });

  server.listen(cfg.port, () => {
    log(`Escutando na porta ${cfg.port}. Saldo inicial: ${balance}`);
    log(`Recovery: ${recoveryTimeoutMs}ms × ${recoveryRetries} tentativas`);
  });
}

module.exports = { startParticipant };
