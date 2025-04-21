import {
    Cat20Metadata,
    Cat20TokenInfo,
    CAT20Utxo,
} from '@cat-protocol/cat-sdk-v2'
import {
    UtxoProvider,
    ChainProvider,
    markSpent,
    Signer,
    ExtPsbt,
} from '@scrypt-inc/scrypt-ts-btc'
import * as bitcoinjs from '@scrypt-inc/bitcoinjs-lib'

export interface TrackerProvider {
    tokenInfo<T extends Cat20Metadata>(
        tokenId: string
    ): Promise<Cat20TokenInfo<T>>

    tokens(tokenId: string, ownerAddr: string): Promise<Array<CAT20Utxo>>
}

export async function processCatPsbts(
    signer: Signer,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    catPsbts: ExtPsbt[]
) {
    // sign
    const signedPsbtHexs = await signer.signPsbts(
        catPsbts.map((catPsbt) => {
            return {
                psbtHex: catPsbt.toHex(),
                options: catPsbt.psbtOptions(),
            }
        })
    )
    const txs: bitcoinjs.Transaction[] = []
    // combine
    for (let index = 0; index < catPsbts.length; index++) {
        const signedPsbtHex = signedPsbtHexs[index]
        const signedCatPsbt = await catPsbts[index]
            .combine(bitcoinjs.Psbt.fromHex(signedPsbtHex))
            .finalizeAllInputs()
        txs.push(signedCatPsbt.extractTransaction())
    }
    // boradcast
    for (let index = 0; index < txs.length; index++) {
        const tx = txs[index]
        await chainProvider.broadcast(tx.toHex())
        markSpent(utxoProvider, tx)
    }
}
