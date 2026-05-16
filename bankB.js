// Banco B — destinatário da transferência.
// Política de voto: sempre aceita (receber dinheiro não tem pré-condição).

const { startParticipant } = require("./participant");

startParticipant({
  name: "Banco B",
  port: 5002,
  initialBalance: 20,
  canAccept: () => true,
  applyCommit: (amount, balance) => balance + amount, // credita
});
