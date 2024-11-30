import {
    CAT20Covenant,
    Cat20GuardCovenant,
    Cat20Utxo,
    CatPsbt,
    ChainProvider,
    DUST_LIMIT,
    GuardType,
    MAX_INPUT,
    Postage,
    Signer,
    TracedCat20Token,
    UtxoProvider,
    getDummyUtxo,
    getDummyUtxos,
    isP2TR,
    pickLargeFeeUtxo,
    toTokenAddress,
} from '@cat-protocol/cat-sdk'
import { CAT20SellCovenant } from '../../../covenants/cat20/cat20SellCovenant'
import { UTXO } from 'scrypt-ts'
import { Psbt } from 'bitcoinjs-lib'

/**
 * cancel sell CAT20, and transfer back to owner
 * @param signer a signer, such as {@link DefaultSigner} or {@link UnisatSigner}
 * @param cat20Covenant a {@link CAT20Covenant}
 * @param cat20SellCovenant a {@link CAT20SellCovenant}
 * @param utxoProvider a {@link UtxoProvider}
 * @param chainProvider a {@link ChainProvider}
 * @param sellCAT20Utxo cat20 token utxo
 * @param feeRate specify the fee rate for constructing transactions
 * @returns returns all transactions
 */
export async function cancelCAT20SellOrder(
    signer: Signer,
    cat20Covenant: CAT20Covenant,
    cat20SellCovenant: CAT20SellCovenant,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    sellCAT20Utxo: Cat20Utxo,
    feeRate: number
) {
    const pubkey = await signer.getPublicKey()
    const address = await signer.getAddress()
    const changeAddress = await signer.getAddress()
    const inputCAT20Utxos = [sellCAT20Utxo]
    const tracableTokens = await CAT20Covenant.backtrace(
        inputCAT20Utxos.map((utxo) => {
            return { ...utxo, minterAddr: cat20Covenant.minterAddr }
        }),
        chainProvider
    )
    const inputTokens = tracableTokens.map((token) => token.token)

    const { guard, outputTokens } = CAT20Covenant.createTransferGuard(
        inputTokens.map((token, i) => ({
            token,
            inputIndex: i + 1,
        })),
        [
            {
                address: toTokenAddress(address),
                amount: sellCAT20Utxo.state.amount,
                outputIndex: 1,
            },
        ]
    )
    const { estGuardTxVSize, dummyGuardPsbt } = estimateGuardTxVSize(
        guard.bindToUtxo({ ...getDummyUtxo(changeAddress), script: undefined }),
        cat20SellCovenant.bindToUtxo({
            ...getDummyUtxo(changeAddress),
            script: undefined,
        }),
        changeAddress
    )

    const estSendTxVSize = estimateSentTxVSize(
        tracableTokens,
        guard,
        cat20SellCovenant,
        dummyGuardPsbt,
        address,
        pubkey,
        outputTokens,
        changeAddress,
        feeRate
    )

    const total =
        feeRate * (estGuardTxVSize + estSendTxVSize) + Postage.TOKEN_POSTAGE // for a token change output
    const utxos = await utxoProvider.getUtxos(changeAddress, { total })

    if (utxos.length === 0) {
        throw new Error('Insufficient satoshis input amount')
    }

    const feeUtxo = pickLargeFeeUtxo(utxos)

    const guardPsbt = buildGuardTx(
        guard,
        cat20SellCovenant,
        [feeUtxo],
        changeAddress,
        feeRate,
        estGuardTxVSize
    )

    const sendPsbt = buildSendTx(
        tracableTokens,
        guard,
        cat20SellCovenant,
        guardPsbt,
        address,
        pubkey,
        outputTokens,
        changeAddress,
        feeRate,
        estSendTxVSize
    )

    // sign the psbts
    const [signedGuardPsbt, signedSendPsbt] = await signer.signPsbts([
        {
            psbtHex: guardPsbt.toHex(),
            options: guardPsbt.psbtOptions(),
        },
        {
            psbtHex: sendPsbt.toHex(),
            options: sendPsbt.psbtOptions(),
        },
    ])

    // combine and finalize the psbts
    const guardTx = await guardPsbt
        .combine(Psbt.fromHex(signedGuardPsbt))
        .finalizeAllInputsAsync()
    const sendTx = await sendPsbt
        .combine(Psbt.fromHex(signedSendPsbt))
        .finalizeAllInputsAsync()

    // broadcast the transactions
    await chainProvider.broadcast(guardTx.extractTransaction().toHex())
    await chainProvider.broadcast(sendTx.extractTransaction().toHex())
    return { guardTx, sendTx }
}

function buildGuardTx(
    guard: Cat20GuardCovenant,
    cat20Sell: CAT20SellCovenant,
    feeUtxos: UTXO[],
    changeAddress: string,
    feeRate: number,
    estimatedVSize?: number
) {
    if (feeUtxos.length > 1) {
        throw new Error('Only one fee input is allowed in the guard tx')
    }

    const totalIn = feeUtxos.reduce(
        (acc, utxo) => acc + BigInt(utxo.satoshis),
        0n
    )

    if (totalIn < Postage.GUARD_POSTAGE + feeRate * (estimatedVSize || 1)) {
        throw new Error('Insufficient satoshis input amount')
    }

    const guardTx = new CatPsbt()
        .addFeeInputs(feeUtxos)
        .addCovenantOutput(guard, Postage.GUARD_POSTAGE)
        .addCovenantOutput(cat20Sell, Postage.TOKEN_POSTAGE)
        .change(changeAddress, feeRate, estimatedVSize)

    guard.bindToUtxo(guardTx.getUtxo(1))

    return guardTx
}

function estimateGuardTxVSize(
    guard: Cat20GuardCovenant,
    cat20Sell: CAT20SellCovenant,
    changeAddress: string
) {
    const dummyGuardPsbt = buildGuardTx(
        guard,
        cat20Sell,
        getDummyUtxos(changeAddress, 1),
        changeAddress,
        DUST_LIMIT
    )
    return {
        dummyGuardPsbt,
        estGuardTxVSize: dummyGuardPsbt.estimateVSize(),
    }
}

function buildSendTx(
    tracableTokens: TracedCat20Token[],
    guard: Cat20GuardCovenant,
    cat20Sell: CAT20SellCovenant,
    guardPsbt: CatPsbt,
    address: string,
    pubKey: string,
    outputTokens: (CAT20Covenant | undefined)[],
    changeAddress: string,
    feeRate: number,
    estimatedVSize?: number
) {
    const inputTokens = tracableTokens.map((token) => token.token)

    if (inputTokens.length + 2 > MAX_INPUT) {
        throw new Error(
            `Too many inputs that exceed the maximum input limit of ${MAX_INPUT}`
        )
    }

    const sendPsbt = new CatPsbt()

    // add token outputs
    for (const outputToken of outputTokens) {
        if (outputToken) {
            sendPsbt.addCovenantOutput(outputToken, Postage.TOKEN_POSTAGE)
        }
    }
    cat20Sell.bindToUtxo(guardPsbt.getUtxo(2))
    sendPsbt.addCovenantInput(cat20Sell)
    // add token inputs
    for (const inputToken of inputTokens) {
        sendPsbt.addCovenantInput(inputToken)
    }

    sendPsbt
        .addCovenantInput(guard, GuardType.Transfer)
        .addFeeInputs([guardPsbt.getUtxo(3)])
        .change(changeAddress, feeRate, estimatedVSize)

    const inputCtxs = sendPsbt.calculateInputCtxs()
    const guardInputIndex = inputTokens.length + 1
    // unlock cat20sell
    sendPsbt.updateCovenantInput(
        0,
        cat20Sell,
        cat20Sell.cancel(0, inputCtxs, isP2TR(address), pubKey)
    )
    // unlock tokens
    for (let i = 1; i < inputTokens.length + 1; i++) {
        sendPsbt.updateCovenantInput(
            i,
            inputTokens[i - 1],
            inputTokens[i - 1].contractSpend(
                i,
                inputCtxs,
                tracableTokens[i - 1].trace,
                guard.getGuardInfo(guardInputIndex, guardPsbt.toTxHex()),
                0
            )
        )
    }

    // unlock guard
    sendPsbt.updateCovenantInput(
        guardInputIndex,
        guard,
        guard.transfer(
            guardInputIndex,
            inputCtxs,
            outputTokens,
            guardPsbt.toTxHex()
        )
    )
    return sendPsbt
}

function estimateSentTxVSize(
    tracableTokens: TracedCat20Token[],
    guard: Cat20GuardCovenant,
    cat20Sell: CAT20SellCovenant,
    guardPsbt: CatPsbt,
    address: string,
    pubKey: string,
    outputTokens: CAT20Covenant[],
    changeAddress: string,
    feeRate: number
) {
    return buildSendTx(
        tracableTokens,
        guard,
        cat20Sell,
        guardPsbt,
        address,
        pubKey,
        outputTokens,
        changeAddress,
        feeRate
    ).estimateVSize()
}
