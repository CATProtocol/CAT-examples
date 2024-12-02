import {
    CAT20Covenant,
    Cat20GuardCovenant,
    Cat20Utxo,
    CatPsbt,
    ChainProvider,
    ChangeInfo,
    DUST_LIMIT,
    GuardType,
    MAX_INPUT,
    Postage,
    Signer,
    TracedCat20Token,
    UtxoProvider,
    getDummyUtxo,
    getDummyUtxos,
    hexToUint8Array,
    int32,
    isP2TR,
    pickLargeFeeUtxo,
    toTokenAddress,
} from '@cat-protocol/cat-sdk'
import { CAT20BuyCovenant } from '../../../covenants/cat20/cat20BuyCovenant'
import { Ripemd160, UTXO, byteString2Int } from 'scrypt-ts'
import { Psbt } from 'bitcoinjs-lib'
import { CAT20Buy } from '../../../contracts/cat20/cat20Buy'

/**
 * take a CAT20 buy order
 * @param signer a signer, such as {@link DefaultSigner} or {@link UnisatSigner}
 * @param cat20Covenant a {@link CAT20Covenant}
 * @param cat20BuyCovenant a {@link CAT20BuyCovenant}
 * @param utxoProvider a {@link UtxoProvider}
 * @param chainProvider a {@link ChainProvider}
 * @param toBuyUserAmount buy cat20 token amount
 * @param serviceFeeInfo service fee
 * @param feeRate specify the fee rate for constructing transactions
 * @returns returns all transactions
 */
export async function takeCAT20BuyOrder(
    signer: Signer,
    cat20Covenant: CAT20Covenant,
    inputTokenUtxos: Cat20Utxo[],
    cat20BuyCovenant: CAT20BuyCovenant,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    toBuyUserAmount: int32,
    serviceFeeInfo: ChangeInfo,
    feeRate: number
) {
    const pubkey = await signer.getPublicKey()
    const address = await signer.getAddress()
    const changeAddress = await signer.getAddress()
    const tracableTokens = await CAT20Covenant.backtrace(
        inputTokenUtxos.map((utxo) => {
            return { ...utxo, minterAddr: cat20Covenant.minterAddr }
        }),
        chainProvider
    )
    const inputTokens = tracableTokens.map((token) => token.token)
    const subContract = cat20BuyCovenant.getSubContract() as CAT20Buy
    let buyAmountSatoshi = toBuyUserAmount * subContract.price
    if (subContract.scalePrice) {
        buyAmountSatoshi = buyAmountSatoshi * 256n
    }
    const remainingSatoshi =
        BigInt(cat20BuyCovenant.utxo.satoshis) - buyAmountSatoshi
    const totalCat20Input = inputTokenUtxos.reduce((c, value) => {
        return c + value.state.amount
    }, 0n)
    const tokenChange = totalCat20Input - toBuyUserAmount
    const receivers: {
        address: Ripemd160
        amount: int32
        outputIndex: number
    }[] = [
        {
            address: Ripemd160(subContract.buyerAddress),
            amount: toBuyUserAmount,
            outputIndex: 1,
        },
    ]
    if (tokenChange > 0n) {
        receivers.push({
            address: toTokenAddress(address),
            amount: tokenChange,
            outputIndex: 2,
        })
    }
    const { guard, outputTokens } = CAT20Covenant.createTransferGuard(
        inputTokens.map((token, i) => ({
            token,
            inputIndex: i + 1,
        })),
        receivers
    )
    const { estGuardTxVSize, dummyGuardPsbt } = estimateGuardTxVSize(
        guard.bindToUtxo({ ...getDummyUtxo(changeAddress), script: undefined }),
        changeAddress
    )

    const estSendTxVSize = estimateSentTxVSize(
        tracableTokens,
        guard,
        cat20BuyCovenant,
        dummyGuardPsbt,
        address,
        pubkey,
        outputTokens,
        toBuyUserAmount,
        tokenChange,
        remainingSatoshi,
        changeAddress,
        feeRate,
        serviceFeeInfo
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
        [feeUtxo],
        changeAddress,
        feeRate,
        estGuardTxVSize
    )

    const sendPsbt = buildSendTx(
        tracableTokens,
        guard,
        cat20BuyCovenant,
        guardPsbt,
        address,
        pubkey,
        outputTokens,
        toBuyUserAmount,
        tokenChange,
        remainingSatoshi,
        changeAddress,
        feeRate,
        serviceFeeInfo,
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
        .change(changeAddress, feeRate, estimatedVSize)

    guard.bindToUtxo(guardTx.getUtxo(1))

    return guardTx
}

function estimateGuardTxVSize(
    guard: Cat20GuardCovenant,
    changeAddress: string
) {
    const dummyGuardPsbt = buildGuardTx(
        guard,
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
    cat20Buy: CAT20BuyCovenant,
    guardPsbt: CatPsbt,
    address: string,
    pubKey: string,
    outputTokens: (CAT20Covenant | undefined)[],
    toBuyUserAmount: int32,
    toSellerAmount: int32,
    remainingSatoshi: int32,
    changeAddress: string,
    feeRate: number,
    serviceFeeInfo: ChangeInfo,
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
    // cat20Buy
    sendPsbt.addCovenantInput(cat20Buy)
    // add token inputs
    for (const inputToken of inputTokens) {
        sendPsbt.addCovenantInput(inputToken)
    }

    sendPsbt
        .addCovenantInput(guard, GuardType.Transfer)
        .addFeeInputs([guardPsbt.getUtxo(2)])
    if (remainingSatoshi > 0n) {
        sendPsbt.addCovenantOutput(cat20Buy, Number(remainingSatoshi))
    }
    if (serviceFeeInfo.satoshis !== '0000000000000000') {
        sendPsbt.addOutput({
            script: hexToUint8Array(serviceFeeInfo.script),
            value: byteString2Int(serviceFeeInfo.satoshis),
        })
    }
    sendPsbt.change(changeAddress, feeRate, estimatedVSize)
    const inputCtxs = sendPsbt.calculateInputCtxs()
    const guardInputIndex = inputTokens.length + 1
    // unlock cat20Buy
    sendPsbt.updateCovenantInput(
        0,
        cat20Buy,
        cat20Buy.take(
            0,
            inputCtxs,
            toBuyUserAmount,
            toSellerAmount,
            toTokenAddress(address),
            serviceFeeInfo
        )
    )
    // unlock tokens
    for (let i = 1; i < inputTokens.length + 1; i++) {
        sendPsbt.updateCovenantInput(
            i,
            inputTokens[i - 1],
            inputTokens[i - 1].userSpend(
                i,
                inputCtxs,
                tracableTokens[i - 1].trace,
                guard.getGuardInfo(guardInputIndex, guardPsbt.toTxHex()),
                isP2TR(address),
                pubKey
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
    cat20Buy: CAT20BuyCovenant,
    guardPsbt: CatPsbt,
    address: string,
    pubKey: string,
    outputTokens: CAT20Covenant[],
    toBuyUserAmount: int32,
    toSellerAmount: int32,
    remainingSatoshi: int32,
    changeAddress: string,
    feeRate: number,
    serviceFeeInfo: ChangeInfo
) {
    return buildSendTx(
        tracableTokens,
        guard,
        cat20Buy,
        guardPsbt,
        address,
        pubKey,
        outputTokens,
        toBuyUserAmount,
        toSellerAmount,
        remainingSatoshi,
        changeAddress,
        feeRate,
        serviceFeeInfo
    ).estimateVSize()
}
