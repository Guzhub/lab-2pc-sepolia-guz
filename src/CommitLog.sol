// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CommitLog — registro imutável das decisões do 2PC na Sepolia
/// @notice Extensão sobre o lab original: o struct agora também guarda `amount`,
///         permitindo que os bancos recuperem o valor da transferência ao
///         consultar o contrato durante recovery (ver bankA.js/bankB.js).
contract CommitLog {
    enum Decision {
        UNKNOWN, // 0 — registro inexistente
        COMMIT,  // 1
        ABORT    // 2
    }

    struct TransactionRecord {
        string transactionId;
        Decision decision;
        uint256 timestamp;
        address coordinator;
        uint256 amount; // novo: valor envolvido na transferência
    }

    mapping(string => TransactionRecord) public records;

    event DecisionRecorded(
        string transactionId,
        Decision decision,
        uint256 timestamp,
        address coordinator,
        uint256 amount
    );

    function recordDecision(
        string memory transactionId,
        Decision decision,
        uint256 amount
    ) public {
        // Imutabilidade: uma transactionId só pode ser registrada uma vez.
        // Isso transforma o contrato num oráculo confiável para recovery.
        require(
            records[transactionId].decision == Decision.UNKNOWN,
            "Decision already recorded"
        );
        require(
            decision == Decision.COMMIT || decision == Decision.ABORT,
            "Invalid decision"
        );

        records[transactionId] = TransactionRecord({
            transactionId: transactionId,
            decision: decision,
            timestamp: block.timestamp,
            coordinator: msg.sender,
            amount: amount
        });

        emit DecisionRecorded(
            transactionId,
            decision,
            block.timestamp,
            msg.sender,
            amount
        );
    }

    function getDecision(
        string memory transactionId
    ) public view returns (Decision) {
        return records[transactionId].decision;
    }
}
