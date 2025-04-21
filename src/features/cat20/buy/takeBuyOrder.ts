import { CAT20BuyCovenant } from '../../../covenants/cat20/cat20BuyCovenant'
import { CAT20Buy } from '../../../contracts/cat20/cat20Buy'
import {
    ByteString,
    ChainProvider,
    ExtPsbt,
    fill,
    FixedArray,
    getBackTraceInfo,
    hexToUint8Array,
    Int32,
    PubKey,
    Ripemd160,
    Sig,
    Signer,
    STATE_OUTPUT_COUNT_MAX,
    toByteString,
    TX_INPUT_COUNT_MAX,
    TxOut,
    TxUtils,
    uint8ArrayToHex,
    UTXO,
    UtxoProvider,
} from '@scrypt-inc/scrypt-ts-btc'
import {
    CAT20Covenant,
    toTokenAddress,
    Postage,
    pickLargeFeeUtxo,
    isP2TR,
    CAT20Utxo,
    CAT20GuardCovenant,
    byteStringToBigInt,
    TracedCAT20Token,
    satoshiToHex,
    CAT20,
    pubKeyPrefix,
    catToXOnly,
    CAT20Guard,
    CAT20State,
    emptyOutputByteStrings,
} from '@cat-protocol/cat-sdk-v2'
import { Psbt, address as Address } from '@scrypt-inc/bitcoinjs-lib'
import { createTransferGuard } from '../../../lib/guardUtils'

// function createTransferGuard(
//     inputInfos: {
//         token: CAT20Covenant
//         inputIndex: number
//     }[],
//     receivers: {
//         address: ByteString
//         amount: Int32
//         outputIndex: number
//     }[],
//     changeInfo?: {
//         address: ByteString
//     }
// ): {
//     guard: CAT20GuardCovenant
//     outputTokens: FixedArray<
//         CAT20Covenant | undefined,
//         typeof STATE_OUTPUT_COUNT_MAX
//     >
//     changeTokenOutputIndex: number
// } {
//     if (inputInfos.length === 0) {
//         throw new Error('No spent tokens')
//     }

//     if (inputInfos.length > TX_INPUT_COUNT_MAX - 1) {
//         throw new Error(
//             `Too many token inputs that exceed the maximum limit of ${TX_INPUT_COUNT_MAX}`
//         )
//     }

//     const totalTokenInputAmount = inputInfos.reduce((acc, info) => {
//         if (!info.token.state) {
//             throw new Error('Token state is missing')
//         }
//         return acc + info.token.state.amount
//     }, 0n)

//     const totalTokenOutputAmount = receivers.reduce(
//         (acc, receiver) => acc + receiver.amount,
//         0n
//     )

//     if (totalTokenInputAmount < totalTokenOutputAmount) {
//         throw new Error('Insufficient token input amount')
//     }

//     if (totalTokenInputAmount > totalTokenOutputAmount && !changeInfo) {
//         throw new Error(
//             'Unbalanced token output amount, change address is missing'
//         )
//     }

//     const changeTokenAmount = totalTokenInputAmount - totalTokenOutputAmount
//     let changeTokenOutputIndex = -1
//     if (changeTokenAmount > 0) {
//         changeTokenOutputIndex = receivers.length + 1
//     }

//     const minterAddr = inputInfos[0].token.minterAddr
//     const guardState = CAT20Guard.createEmptyState()
//     guardState.tokenScripts[0] = inputInfos[0].token.lockingScriptHex
//     for (let index = 0; index < inputInfos.length; index++) {
//         const inputInfo = inputInfos[index]
//         guardState.tokenScriptIndexes[inputInfo.inputIndex] = 0n
//         guardState.inputStateHashes[inputInfo.inputIndex] = CAT20.stateHash(
//             inputInfos[index].token.state
//         )
//     }
//     guardState.tokenAmounts[0] = inputInfos.reduce(
//         (p, c) => p + c.token.state.amount,
//         0n
//     )
//     const guard = new CAT20GuardCovenant(guardState)
//     const outputTokens = emptyOutputByteStrings().map((_, index) => {
//         const receiver = receivers.find((r) => r.outputIndex === index + 1)
//         if (receiver) {
//             if (receiver.amount <= 0) {
//                 throw new Error(
//                     `Invalid token amount ${receiver.amount} for output ${
//                         index + 1
//                     }`
//                 )
//             }
//             return new CAT20Covenant(minterAddr, {
//                 amount: receiver.amount,
//                 ownerAddr: receiver.address,
//             })
//         } else if (
//             changeTokenAmount > 0 &&
//             index + 1 === changeTokenOutputIndex
//         ) {
//             return new CAT20Covenant(minterAddr, {
//                 amount: changeTokenAmount,
//                 ownerAddr: changeInfo.address,
//             })
//         } else {
//             return undefined
//         }
//     }) as FixedArray<CAT20Covenant | undefined, typeof STATE_OUTPUT_COUNT_MAX>
//     return {
//         guard,
//         outputTokens,
//         changeTokenOutputIndex,
//     }
// }

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
    inputTokenUtxos: CAT20Utxo[],
    cat20BuyCovenant: CAT20BuyCovenant,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    toBuyUserAmount: Int32,
    serviceFeeInfo: TxOut,
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
        address: ByteString
        amount: Int32
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
    const { guard, outputTokens } = createTransferGuard(
        inputTokens.map((token, i) => ({
            token,
            inputIndex: i + 1,
        })),
        receivers
    )

    const utxos = await utxoProvider.getUtxos(changeAddress)

    if (utxos.length === 0) {
        throw new Error('Insufficient satoshis input amount')
    }

    const feeUtxo = pickLargeFeeUtxo(utxos)

    const guardPsbt = buildGuardTx(guard, [feeUtxo], changeAddress, feeRate)

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
        serviceFeeInfo
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

    const guardTx = new ExtPsbt()
        .spendUTXO(feeUtxos)
        .addCovenantOutput(guard, Postage.GUARD_POSTAGE)
        .change(changeAddress, feeRate)

    guard.bindToUtxo(guardTx.getUtxo(1))
    guardTx.seal()
    return guardTx
}

function buildSendTx(
    tracableTokens: TracedCAT20Token[],
    guard: CAT20GuardCovenant,
    cat20Buy: CAT20BuyCovenant,
    guardPsbt: ExtPsbt,
    address: string,
    pubKey: string,
    outputTokens: (CAT20Covenant | undefined)[],
    toBuyUserAmount: Int32,
    toSellerAmount: Int32,
    remainingSatoshi: Int32,
    changeAddress: string,
    feeRate: number,
    serviceFeeInfo: TxOut
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
    // cat20Buy
    sendPsbt.addCovenantInput(cat20Buy)
    // add token inputs
    for (const inputToken of inputTokens) {
        sendPsbt.addCovenantInput(inputToken)
    }

    sendPsbt.addCovenantInput(guard).spendUTXO([guardPsbt.getUtxo(2)])
    if (remainingSatoshi > 0n) {
        sendPsbt.addCovenantOutput(cat20Buy, Number(remainingSatoshi))
    }
    if (serviceFeeInfo.satoshis !== '0000000000000000') {
        sendPsbt.addOutput({
            script: hexToUint8Array(serviceFeeInfo.script),
            value: byteStringToBigInt(serviceFeeInfo.satoshis),
        })
    }
    sendPsbt.change(changeAddress, feeRate)
    const guardInputIndex = inputTokens.length + 1
    // unlock cat20Buy
    sendPsbt.updateCovenantInput(0, cat20Buy, {
        invokeMethod: (contract: CAT20Buy) => {
            let preRemainingAmount = BigInt(cat20Buy.utxo.satoshis)
            if (contract.scalePrice) {
                preRemainingAmount = preRemainingAmount / 256n
            }
            contract.take(
                preRemainingAmount / contract.price,
                toBuyUserAmount,
                toSellerAmount,
                toTokenAddress(address),
                satoshiToHex(BigInt(Postage.TOKEN_POSTAGE)),
                1n,
                false,
                toByteString(''),
                toByteString('') as PubKey,
                toByteString('') as Sig,
                {
                    satoshis: TxUtils.ZERO_SATS,
                    script: '',
                }
            )
        },
    })
    // unlock tokens
    const _isP2TR = isP2TR(changeAddress)
    for (let i = 1; i < inputTokens.length + 1; i++) {
        sendPsbt.updateCovenantInput(i, inputTokens[i - 1], {
            invokeMethod: (contract: CAT20, curPsbt) => {
                const sig = curPsbt.getSig(i, {
                    address: address,
                    disableTweakSigner: _isP2TR ? false : true,
                })
                contract.unlock(
                    {
                        userPubKeyPrefix: _isP2TR ? '' : pubKeyPrefix(pubKey),
                        userXOnlyPubKey: PubKey(catToXOnly(pubKey, _isP2TR)),
                        userSig: sig,
                        contractInputIndexVal: -1n,
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
    sendPsbt.updateCovenantInput(guardInputIndex, guard, {
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

            const ownerAddrOrScripts = tokenOwners.map((ownerAddr, oidx) => {
                const output = curPsbt.txOutputs[oidx + 1]
                return (
                    ownerAddr ||
                    (output
                        ? uint8ArrayToHex(output.script)
                        : sendPsbt.isSealed
                        ? ''
                        : uint8ArrayToHex(
                              Address.toOutputScript(changeAddress)
                          ))
                )
            }) as unknown as FixedArray<
                ByteString,
                typeof STATE_OUTPUT_COUNT_MAX
            >

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
                ownerAddrOrScripts,
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
    sendPsbt.seal()
    return sendPsbt
}
