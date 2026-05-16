// Banco A — remetente da transferência.
// Política de voto: só aceita se tiver saldo suficiente.

const { startParticipant } = require("./participant");

startParticipant({
  name: "Banco A",
  port: 5001,
  initialBalance: 100,
  canAccept: (amount, balance) => balance >= amount,
  applyCommit: (amount, balance) => balance - amount, // debita
});
