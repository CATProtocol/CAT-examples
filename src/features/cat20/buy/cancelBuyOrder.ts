import { CatPsbt, ChainProvider, Signer, isP2TR } from '@cat-protocol/cat-sdk'
import { CAT20BuyCovenant } from '../../../covenants/cat20/cat20BuyCovenant'
import { Psbt } from 'bitcoinjs-lib'

/**
 * cancel buy CAT20, and transfer satoshis back to owner
 * @param signer a signer, such as {@link DefaultSigner} or {@link UnisatSigner}
 * @param cat20BuyCovenant a {@link CAT20BuyCovenant}
 * @param chainProvider a {@link ChainProvider}
 * @param buyCAT20Utxo cat20 token utxo
 * @param feeRate specify the fee rate for constructing transactions
 * @returns returns all transactions
 */
export async function cancelCAT20BuyOrder(
    signer: Signer,
    cat20BuyCovenant: CAT20BuyCovenant,
    chainProvider: ChainProvider,
    feeRate: number
) {
    const pubkey = await signer.getPublicKey()
    const address = await signer.getAddress()
    const changeAddress = await signer.getAddress()

    const cancelPsbt = buildCancelTx(
        cat20BuyCovenant,
        address,
        pubkey,
        changeAddress,
        feeRate
    )

    // sign the psbts
    const [signedCancelPsbt] = await signer.signPsbts([
        {
            psbtHex: cancelPsbt.toHex(),
            options: cancelPsbt.psbtOptions(),
        },
    ])

    // combine and finalize the psbts
    const cancelTx = await cancelPsbt
        .combine(Psbt.fromHex(signedCancelPsbt))
        .finalizeAllInputsAsync()

    // broadcast the transactions
    await chainProvider.broadcast(cancelTx.extractTransaction().toHex())
    return { cancelTx }
}

function buildCancelTx(
    cat20Buy: CAT20BuyCovenant,
    address: string,
    pubKey: string,
    changeAddress: string,
    feeRate: number,
    estimatedVSize?: number
) {
    const cancelPsbt = new CatPsbt()
    cancelPsbt.addCovenantInput(cat20Buy)
    cancelPsbt.change(changeAddress, feeRate, estimatedVSize)
    const inputCtxs = cancelPsbt.calculateInputCtxs()
    // unlock cat20cancel
    cancelPsbt.updateCovenantInput(
        0,
        cat20Buy,
        cat20Buy.cancel(0, inputCtxs, isP2TR(address), pubKey)
    )
    return cancelPsbt
}
