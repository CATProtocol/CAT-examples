import {
    ByteString,
    ChainProvider,
    ExtPsbt,
    fill,
    FixedArray,
    getBackTraceInfo,
    hash160,
    Int32,
    PubKey,
    PubKeyHash,
    Sig,
    Signer,
    STATE_OUTPUT_COUNT_MAX,
    toByteString,
    TX_INPUT_COUNT_MAX,
    TxUtils,
    uint8ArrayToHex,
    UTXO,
    UtxoProvider,
} from '@scrypt-inc/scrypt-ts-btc'
import { CAT20SellCovenant } from '../../../covenants/cat20/cat20SellCovenant'
import {
    CAT20,
    CAT20Covenant,
    CAT20Guard,
    CAT20GuardCovenant,
    CAT20State,
    CAT20Utxo,
    catToXOnly,
    emptyOutputByteStrings,
    isP2TR,
    pickLargeFeeUtxo,
    Postage,
    pubKeyPrefix,
    satoshiToHex,
    toTokenAddress,
    TracedCAT20Token,
} from '@cat-protocol/cat-sdk-v2'
import { Psbt } from '@scrypt-inc/bitcoinjs-lib'
import { CAT20Sell } from '../../../contracts/cat20/cat20Sell'
import { createTransferGuard } from '../../../lib/guardUtils'

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
    sellCAT20Utxo: CAT20Utxo,
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

    const { guard, outputTokens } = createTransferGuard(
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

    const utxos = await utxoProvider.getUtxos(changeAddress)

    if (utxos.length === 0) {
        throw new Error('Insufficient satoshis input amount')
    }

    const feeUtxo = pickLargeFeeUtxo(utxos)
    const guardPsbt = buildGuardTx(
        guard,
        cat20SellCovenant,
        [feeUtxo],
        changeAddress,
        feeRate
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
        feeRate
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
        .finalizeAllInputs()
    const sendTx = await sendPsbt
        .combine(Psbt.fromHex(signedSendPsbt))
        .finalizeAllInputs()

    // broadcast the transactions
    await chainProvider.broadcast(guardTx.extractTransaction().toHex())
    await chainProvider.broadcast(sendTx.extractTransaction().toHex())
    return { guardTx, sendTx }
}

function buildGuardTx(
    guard: CAT20GuardCovenant,
    cat20Sell: CAT20SellCovenant,
    feeUtxos: UTXO[],
    changeAddress: string,
    feeRate: number
) {
    if (feeUtxos.length > 1) {
        throw new Error('Only one fee input is allowed in the guard tx')
    }

    const guardTx = new ExtPsbt()
        .spendUTXO(feeUtxos)
        .addCovenantOutput(guard, Postage.GUARD_POSTAGE)
        .addCovenantOutput(cat20Sell, Postage.TOKEN_POSTAGE)
        .change(changeAddress, feeRate)
        .seal()
    guard.bindToUtxo(guardTx.getUtxo(1))
    return guardTx
}

function buildSendTx(
    tracableTokens: TracedCAT20Token[],
    guard: CAT20GuardCovenant,
    cat20Sell: CAT20SellCovenant,
    guardPsbt: ExtPsbt,
    address: string,
    pubKey: string,
    outputTokens: (CAT20Covenant | undefined)[],
    changeAddress: string,
    feeRate: number
) {
    const inputTokens = tracableTokens.map((token) => token.token)

    if (inputTokens.length + 2 > TX_INPUT_COUNT_MAX) {
        throw new Error(
            `Too many inputs that exceed the maximum input limit of ${TX_INPUT_COUNT_MAX}`
        )
    }

    const sendPsbt = new ExtPsbt()

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
        .addCovenantInput(guard)
        .spendUTXO([guardPsbt.getUtxo(3)])
        .change(changeAddress, feeRate)
    const guardInputIndex = inputTokens.length + 1
    // unlock cat20sell
    sendPsbt.updateCovenantInput(0, cat20Sell, {
        invokeMethod: (contract: CAT20Sell, curPsbt: ExtPsbt) => {
            contract.take(
                1n,
                0n,
                0n,
                PubKeyHash('00'),
                satoshiToHex(BigInt(Postage.TOKEN_POSTAGE)),
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
    // unlock tokens
    for (let i = 1; i < inputTokens.length + 1; i++) {
        sendPsbt.updateCovenantInput(i, inputTokens[i - 1], {
            invokeMethod: (contract: CAT20) => {
                const contractHash = contract.state.ownerAddr
                const contractInputIndexVal =
                    contract.ctx.spentScripts.findIndex(
                        (v) => hash160(v) === contractHash
                    )
                contract.unlock(
                    {
                        userPubKeyPrefix: toByteString(''),
                        userXOnlyPubKey: toByteString('') as PubKey,
                        userSig: toByteString('') as Sig,
                        contractInputIndexVal: BigInt(contractInputIndexVal),
                    },
                    guard.state,
                    BigInt(guardInputIndex),
                    getBackTraceInfo(
                        tracableTokens[i - 1].trace.prevTxHex,
                        tracableTokens[i - 1].trace.prevPrevTxHex,
                        tracableTokens[i - 1].trace.prevTxInput
                    )
                )
            },
        })
    }

    const cat20StateArray = fill<CAT20State, typeof TX_INPUT_COUNT_MAX>(
        { ownerAddr: toByteString(''), amount: 0n },
        TX_INPUT_COUNT_MAX
    )
    inputTokens.forEach((value, index) => {
        if (value) {
            cat20StateArray[index + 1] = value.state
        }
    })
    // unlock guard
    sendPsbt
        .updateCovenantInput(guardInputIndex, guard, {
            invokeMethod: (contract: CAT20Guard, curPsbt: ExtPsbt) => {
                const tokenOwners = outputTokens.map(
                    (output) => output?.state!.ownerAddr || ''
                )
                const tokenAmounts = outputTokens.map(
                    (output) => output?.state!.amount || 0n
                )
                const tokenScriptIndexArray = fill(-1n, STATE_OUTPUT_COUNT_MAX)
                outputTokens.forEach((value, index) => {
                    if (value) {
                        tokenScriptIndexArray[index] = 0n
                    }
                })

                const outputSatoshisList = curPsbt.getOutputSatoshisList()
                const outputSatoshis = emptyOutputByteStrings().map(
                    (emtpyStr, i) => {
                        if (outputSatoshisList[i + 1]) {
                            return outputSatoshisList[i + 1]
                        } else {
                            return emtpyStr
                        }
                    }
                ) as FixedArray<ByteString, typeof STATE_OUTPUT_COUNT_MAX>

                contract.unlock(
                    tokenOwners.map((ownerAddr, oidx) => {
                        const output = curPsbt.txOutputs[oidx + 1]
                        return (
                            ownerAddr ||
                            (output ? uint8ArrayToHex(output.script) : '')
                        )
                    }) as unknown as FixedArray<
                        ByteString,
                        typeof STATE_OUTPUT_COUNT_MAX
                    >,
                    tokenAmounts as unknown as FixedArray<
                        Int32,
                        typeof STATE_OUTPUT_COUNT_MAX
                    >,
                    tokenScriptIndexArray,
                    outputSatoshis,
                    cat20StateArray,
                    BigInt(curPsbt.txOutputs.length - 1)
                )
            },
        })
        .seal()
    return sendPsbt
}
