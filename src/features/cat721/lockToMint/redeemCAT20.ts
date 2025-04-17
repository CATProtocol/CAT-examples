import {
    CAT20Covenant,
    Cat20GuardCovenant,
    Cat20Utxo,
    CatPsbt,
    ChainProvider,
    DUST_LIMIT,
    GuardType,
    MAX_INPUT,
    MAX_STATE,
    Postage,
    Signer,
    TracedCat20Token,
    UtxoProvider,
    bitcoinjs,
    getDummyUtxo,
    getDummyUtxos,
    hexToUint8Array,
    int32,
    isP2TR,
    pubKeyPrefix,
    toTokenAddress,
    toXOnly,
    uint8ArrayToHex,
} from '@cat-protocol/cat-sdk'
import { LockToMintCovenant } from '../../../covenants/cat721/lockToMintCovenant'
import {
    LockToMint,
    MINIMAL_LOCKED_BLOCKS,
} from '../../../contracts/cat721/lockToMint'
import {
    ByteString,
    FixedArray,
    UTXO,
    assert,
    hash160,
    int2ByteString,
    len,
    toByteString,
} from 'scrypt-ts'
import { processCatPsbts } from '../../../lib/provider'

export type OtherOutputs = { script: string; satoshis: number }[]

const buildCatTimeLockRedeem = (
    pubkey: ByteString,
    nonce: ByteString,
    lockedBlocks: int32
) => {
    // exec in legacy bvm runtime, ecdsa sig
    // <pubkey1><pubkey2><nonce><lockedBlocks>76b2516d005579515679567952ae6b6d6d6c77
    let pubkey1 = pubkey
    let pubkey2 = pubkey
    if (len(pubkey) == 32n) {
        pubkey1 = toByteString('02') + pubkey
        pubkey2 = toByteString('03') + pubkey
    }
    assert(lockedBlocks >= MINIMAL_LOCKED_BLOCKS)
    const lockedBlocksBytes = int2ByteString(lockedBlocks)
    return (
        toByteString('21') +
        pubkey1 +
        toByteString('21') +
        pubkey2 +
        int2ByteString(len(nonce)) +
        nonce +
        int2ByteString(len(lockedBlocksBytes)) +
        lockedBlocksBytes +
        toByteString('76b2516d005579515679567952ae6b6d6d6c77')
    )
}

export async function redeemCAT20(
    signer: Signer,
    feeUtxo: UTXO,
    cat20Covenant: CAT20Covenant,
    lockToMintCovenant: LockToMintCovenant,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    feeRate: number
): Promise<{
    catPsbts: CatPsbt[]
}> {
    const pubkey = await signer.getPublicKey()
    const address = await signer.getAddress()
    const lockToMint = lockToMintCovenant.getSubContract() as LockToMint
    const _isP2TR = isP2TR(address)
    const useTweakedSigner = _isP2TR
    const _pubKeyPrefix = _isP2TR ? '' : pubKeyPrefix(pubkey)
    const _pubkeyX = toXOnly(pubkey, _isP2TR)
    const timeLockScriptHex = LockToMint.buildCatTimeLockP2wsh(
        _pubKeyPrefix + _pubkeyX,
        lockToMint.nonce,
        lockToMint.lockedBlocks
    )
    const redeemScript = buildCatTimeLockRedeem(
        _pubKeyPrefix + _pubkeyX,
        lockToMint.nonce,
        lockToMint.lockedBlocks
    )
    const timeLockAddress = bitcoinjs.payments.p2wsh({
        output: hexToUint8Array(timeLockScriptHex),
    }).address
    const timeLockUtxos = await utxoProvider.getUtxos(timeLockAddress)
    if (timeLockUtxos.length === 0) {
        throw Error('no locked')
    }
    const selectTimeLockUtxo = timeLockUtxos[0]
    const txid = selectTimeLockUtxo.txId
    const txHex = await chainProvider.getRawTransaction(txid)
    const tx = bitcoinjs.Transaction.fromHex(txHex)
    const txoStateHashes = tx.ins[3].witness
        .slice(0, 5)
        .map(uint8ArrayToHex) as FixedArray<ByteString, typeof MAX_STATE>
    const cat20Utxo: Cat20Utxo = {
        utxo: {
            txId: txid,
            outputIndex: 2,
            script: cat20Covenant.lockingScriptHex,
            satoshis: Postage.TOKEN_POSTAGE,
        },
        txoStateHashes: txoStateHashes,
        state: {
            ownerAddr: hash160(timeLockScriptHex),
            amount: lockToMint.lockTokenAmount,
        },
    }
    const tracableTokens = await CAT20Covenant.backtrace(
        [cat20Utxo].map((utxo) => {
            return { ...utxo, minterAddr: cat20Covenant.minterAddr }
        }),
        chainProvider
    )
    const inputTokens = tracableTokens.map((token) => token.token)
    const tokenAddr = toTokenAddress(address)
    const receivers = [
        {
            address: tokenAddr,
            amount: lockToMint.lockTokenAmount,
        },
    ]
    const { guard, outputTokens } = CAT20Covenant.createTransferGuard(
        inputTokens.map((token, i) => ({
            token,
            inputIndex: i,
        })),
        receivers.map((receiver, index) => ({
            ...receiver,
            outputIndex: index + 1,
        })),
        {
            address: tokenAddr,
        }
    )
    const { estGuardTxVSize, dummyGuardPsbt } = estimateGuardTxVSize(
        guard.bindToUtxo({ ...getDummyUtxo(address), script: undefined }),
        address
    )
    const estSendTxVSize = estimateSentTxVSize(
        tracableTokens,
        guard,
        dummyGuardPsbt,
        outputTokens,
        address,
        selectTimeLockUtxo,
        redeemScript,
        feeRate
    )
    const guardPsbt = buildGuardTx(
        guard,
        feeUtxo,
        address,
        feeRate,
        estGuardTxVSize
    )
    const sendPsbt = buildSendTx(
        tracableTokens,
        guard,
        guardPsbt,
        outputTokens,
        address,
        feeRate,
        selectTimeLockUtxo,
        redeemScript,
        Number(lockToMint.lockedBlocks),
        useTweakedSigner,
        estSendTxVSize
    )
    const catPsbts = [guardPsbt, sendPsbt]
    await processCatPsbts(signer, utxoProvider, chainProvider, catPsbts)
    return {
        catPsbts,
    }
}

function buildGuardTx(
    guard: Cat20GuardCovenant,
    feeUtxo: UTXO,
    changeAddress: string,
    feeRate: number,
    estimatedVSize?: number
) {
    if (
        feeUtxo.satoshis <
        Postage.GUARD_POSTAGE + feeRate * (estimatedVSize || 1)
    ) {
        throw new Error('Insufficient satoshis input amount')
    }

    const guardTx = new CatPsbt()
        .addFeeInputs([feeUtxo])
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
        getDummyUtxos(changeAddress, 1)[0],
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
    guardPsbt: CatPsbt,
    outputTokens: (CAT20Covenant | undefined)[],
    changeAddress: string,
    feeRate: number,
    selectTimeLockUtxo: UTXO,
    redeemScript: string,
    sequence: number,
    useTweakedSigner: boolean,
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

    // add token inputs
    for (const inputToken of inputTokens) {
        sendPsbt.addCovenantInput(inputToken)
    }

    sendPsbt.addCovenantInput(guard, GuardType.Transfer)

    sendPsbt.addInput({
        hash: selectTimeLockUtxo.txId,
        index: selectTimeLockUtxo.outputIndex,
        witnessScript: hexToUint8Array(redeemScript),
        sighashType:
            bitcoinjs.Transaction.SIGHASH_NONE |
            bitcoinjs.Transaction.SIGHASH_ANYONECANPAY,
        witnessUtxo: {
            value: BigInt(selectTimeLockUtxo.satoshis),
            script: hexToUint8Array(selectTimeLockUtxo.script),
        },
        sequence: sequence,
        finalizer: (self, inputIndex, input) => {
            if (input.partialSig) {
                const sig = input.partialSig![0]
                if (sig && input.witnessScript) {
                    return [
                        Buffer.from(sig.signature),
                        Buffer.from(input.witnessScript),
                    ]
                }
            }
            return []
        },
        sigRequests: [
            {
                inputIndex: 2,
                options: {
                    address: changeAddress,
                    sighashTypes: [
                        bitcoinjs.Transaction.SIGHASH_NONE |
                            bitcoinjs.Transaction.SIGHASH_ANYONECANPAY,
                    ],
                    useTweakedSigner: useTweakedSigner,
                },
            },
        ],
    })
    sendPsbt
        .addFeeInputs([guardPsbt.getUtxo(2)])
        .change(changeAddress, feeRate, estimatedVSize + 21)
    const inputCtxs = sendPsbt.calculateInputCtxs()
    const guardInputIndex = inputTokens.length
    for (let i = 0; i < inputTokens.length; i++) {
        sendPsbt.updateCovenantInput(
            i,
            inputTokens[i],
            inputTokens[i].contractSpend(
                i,
                inputCtxs,
                tracableTokens[i].trace,
                guard.getGuardInfo(guardInputIndex, guardPsbt.toTxHex()),
                2
            )
        )
    }
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
    guardPsbt: CatPsbt,
    outputTokens: CAT20Covenant[],
    changeAddress: string,
    selectTimeLockUtxo: UTXO,
    redeemScript: string,
    feeRate: number
) {
    return buildSendTx(
        tracableTokens,
        guard,
        guardPsbt,
        outputTokens,
        changeAddress,
        feeRate,
        selectTimeLockUtxo,
        redeemScript,
        0,
        false
    ).estimateVSize()
}
