import {
    ChainProvider,
    Signer,
    UtxoProvider,
    toTokenAddress,
    int32,
    getDummyUtxo,
    getDummyUtxos,
    CatPsbt,
} from '@cat-protocol/cat-sdk'
import { CAT20BuyCovenant } from '../../../covenants/cat20/cat20BuyCovenant'
import { CAT20Covenant } from '@cat-protocol/cat-sdk'
import { CAT20Buy } from '../../../contracts/cat20/cat20Buy'
import { Psbt } from 'bitcoinjs-lib'
import { UTXO } from 'scrypt-ts'

/**
 * create CAT20 buy order, and lock satoshis to buy order output
 * @param signer a signer, such as {@link DefaultSigner} or {@link UnisatSigner}
 * @param cat20Covenant a {@link CAT20Covenant}
 * @param utxoProvider a {@link UtxoProvider}
 * @param chainProvider a {@link ChainProvider}
 * @param buyAmount buy cat20 amount
 * @param price cat20 sell price
 * @param scalePrice is price scale 8bit
 * @param feeRate specify the fee rate for constructing transactions
 * @returns returns all transactions
 */

export async function createCAT20BuyOrder(
    signer: Signer,
    cat20Covenant: CAT20Covenant,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    buyAmount: int32,
    price: bigint,
    scalePrice: boolean,
    feeRate: number
) {
    const address = await signer.getAddress()
    const tokenAddress = toTokenAddress(address)
    const changeAddress = await signer.getAddress()
    const buy = new CAT20BuyCovenant(
        cat20Covenant.lockingScriptHex,
        tokenAddress,
        price,
        scalePrice
    )
    let supply = buyAmount * price
    if (scalePrice) {
        supply = supply * 256n
    }

    const { estSendTxVSize } = estimateSendTxVSize(
        buy.bindToUtxo({
            ...getDummyUtxo(changeAddress),
            script: undefined,
        }),
        supply,
        changeAddress
    )

    const total = feeRate * estSendTxVSize + Number(supply)
    const utxos = await utxoProvider.getUtxos(changeAddress, { total })
    if (utxos.length === 0) {
        throw new Error('Insufficient satoshis input amount')
    }

    const sendPsbt = buildSendTx(
        buy,
        supply,
        utxos,
        changeAddress,
        feeRate,
        estSendTxVSize
    )

    // sign the psbts
    const [signedSendPsbt] = await signer.signPsbts([
        {
            psbtHex: sendPsbt.toHex(),
            options: sendPsbt.psbtOptions(),
        },
    ])
    const sendTx = await sendPsbt
        .combine(Psbt.fromHex(signedSendPsbt))
        .finalizeAllInputsAsync()
    const subContract = buy.getSubContract() as CAT20Buy
    await chainProvider.broadcast(sendTx.extractTransaction().toHex())
    const orderInfo = {
        cat20Script: subContract.cat20Script,
        buyerAddress: subContract.buyerAddress,
        price: subContract.price,
        scalePrice: subContract.scalePrice,
        txids: [sendTx.extractTransaction().getId()],
    }
    return { sendTx, orderInfo }
}

export function buildSendTx(
    buy: CAT20BuyCovenant,
    buySatoshi: bigint,
    feeUtxos: UTXO[],
    changeAddress: string,
    feeRate: number,
    estimatedVSize?: number
) {
    if (feeUtxos.length > 1) {
        throw new Error('Only one fee input is allowed in the guard tx')
    }
    const sendTx = new CatPsbt()
        .addFeeInputs(feeUtxos)
        .addCovenantOutput(buy, Number(buySatoshi))
        .change(changeAddress, feeRate, estimatedVSize)

    buy.bindToUtxo(sendTx.getUtxo(1))
    return sendTx
}

export function estimateSendTxVSize(
    buy: CAT20BuyCovenant,
    buySatoshi: bigint,
    changeAddress: string
) {
    const dummySendPsbt = buildSendTx(
        buy,
        buySatoshi,
        getDummyUtxos(changeAddress, 1),
        changeAddress,
        1
    )
    return {
        dummySendPsbt: dummySendPsbt,
        estSendTxVSize: dummySendPsbt.estimateVSize(),
    }
}
