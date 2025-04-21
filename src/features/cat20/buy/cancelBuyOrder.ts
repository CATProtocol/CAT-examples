import {
    ChainProvider,
    ExtPsbt,
    PubKey,
    PubKeyHash,
    Sig,
    Signer,
    TxUtils,
} from '@scrypt-inc/scrypt-ts-btc'
import { CAT20BuyCovenant } from '../../../covenants/cat20/cat20BuyCovenant'
import { Psbt } from '@scrypt-inc/bitcoinjs-lib'
import { CAT20Buy } from '../../../contracts/cat20/cat20Buy'
import {
    catToXOnly,
    isP2TR,
    Postage,
    pubKeyPrefix,
    satoshiToHex,
} from '@cat-protocol/cat-sdk-v2'

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
        .finalizeAllInputs()

    // broadcast the transactions
    await chainProvider.broadcast(cancelTx.extractTransaction().toHex())
    return { cancelTx }
}

function buildCancelTx(
    cat20Buy: CAT20BuyCovenant,
    address: string,
    pubKey: string,
    changeAddress: string,
    feeRate: number
) {
    const cancelPsbt = new ExtPsbt()
    cancelPsbt.addCovenantInput(cat20Buy)
    cancelPsbt.change(changeAddress, feeRate)
    // unlock cat20cancel
    cancelPsbt.updateCovenantInput(0, cat20Buy, {
        invokeMethod: (contract: CAT20Buy, curPsbt: ExtPsbt) => {
            let preRemainingAmount = BigInt(cat20Buy.utxo.satoshis)
            if (contract.scalePrice) {
                preRemainingAmount = preRemainingAmount / 256n
            }
            contract.take(
                preRemainingAmount,
                0n,
                0n,
                PubKeyHash('00'),
                satoshiToHex(BigInt(Postage.TOKEN_POSTAGE)),
                1n,
                true,
                isP2TR(address) ? '' : pubKeyPrefix(pubKey),
                catToXOnly(pubKey, isP2TR(address)) as PubKey,
                curPsbt.getSig(0, {
                    publicKey: pubKey,
                }) as Sig,
                {
                    satoshis: TxUtils.ZERO_SATS,
                    script: '',
                }
            )
        },
    })
    cancelPsbt.seal()
    return cancelPsbt
}
