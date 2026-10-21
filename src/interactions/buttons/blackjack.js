'use strict';

/**
 * Stub przycisku dla /blackjack. Akcje (hit/stand) obsluguje kolektor
 * przypiety do wiadomosci w src/commands/economy/blackjack.js — globalny
 * dispatcher w src/events/interactionCreate.js szuka jednak handlera dla
 * kazdego customId. Ten plik istnieje, zeby dispatcher nie zwrocil bledu,
 * a kolektor mogl w spokoju zaktualizowac wiadomosc przez i.update().
 */
module.exports = {
  namespace: 'bj',
  async execute() {
    // no-op — logika w commands/economy/blackjack.js
  },
};
