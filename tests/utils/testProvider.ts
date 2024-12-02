import { UTXO } from "scrypt-ts";
import { Transaction } from "bitcoinjs-lib";
import { ChainProvider, UtxoProvider, getDummyUtxo } from "@cat-protocol/cat-sdk";

export class TestChainProvider implements ChainProvider {

  private broadcastedTxs: Map<string, string> = new Map()

  constructor() {}
  getConfirmations(txId: string): Promise<number> {
    return Promise.resolve(1);
  }

  async broadcast(txHex: string): Promise<string> {
    const tx = Transaction.fromHex(txHex)
    const txId = tx.getId()
    this.broadcastedTxs.set(txId, txHex)
    // console.log(`Broadcasted tx with id: ${txId}, hex: ${txHex}`)
    return txId
  }

  async getRawTransaction(txId: string): Promise<string> {
    const txHex = this.broadcastedTxs.get(txId)
    if (!txHex) {
      throw new Error(`Can not find the tx with id ${txId}, please broadcast it by using the TestProvider first`)
    }
    return txHex
  }
}


export class TestUtxoProvider implements UtxoProvider {
  constructor() {}
  markSpent(txId: string, vout: number): void {

  }
  addNewUTXO(utxo: UTXO): void {
  }

  async getUtxos(address: string, options?: { total?: number; maxCnt?: number }): Promise<UTXO[]> {
    return Promise.resolve([getDummyUtxo(address)])
  }
}

export const testChainProvider = new TestChainProvider()
export const testUtxoProvider = new TestUtxoProvider()
