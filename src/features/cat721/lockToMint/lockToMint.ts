import {
    CAT20Covenant,
    Cat20GuardCovenant,
    CAT721Covenant,
    CAT721GuardCovenant,
    CAT721State,
    Cat20Utxo,
    Cat721Utxo,
    CatPsbt,
    ChainProvider,
    DUST_LIMIT,
    GuardType,
    Postage,
    Signer,
    TracedCat721Nft,
    UtxoProvider,
    hexToUint8Array,
    isP2TR,
    pubKeyPrefix,
    toXOnly,
    TracedCat20Token,
    bitcoinjs,
    toTokenAddress,
    txToTxHeaderTiny,
    getBackTraceInfo_,
    btc,
    txToTxHeader,
    PreTxStatesInfo,
    uint8ArrayToHex,
    ChangeInfo,
    int32,
} from '@cat-protocol/cat-sdk'
import { Ripemd160, UTXO, hash160, int2ByteString } from 'scrypt-ts'
import { LockToMintCovenant } from '../../../covenants/cat721/lockToMintCovenant'
import { LockToMint } from '../../../contracts/cat721/lockToMint'

/**
 * lock CAT20 mint a CAT721
 */
export async function lockToMint(
    signer: Signer,
    cat20Covenant: CAT20Covenant,
    cat721Covenant: CAT721Covenant,
    nftReceiver: string,
    lockToMintCovenant: LockToMintCovenant,
    utxoProvider: UtxoProvider,
    chainProvider: ChainProvider,
    cat721Utxo: Cat721Utxo,
    cat20Utxo: Cat20Utxo,
    feeRate: number,
    serviceFeeAddress: string,
    serviceFee: number
) {
    const pubkey = await signer.getPublicKey()
    const address = await signer.getAddress()
    const changeAddress = await signer.getAddress()
    const inputCAT721Utxos = [cat721Utxo]
    const inputCAT20Utxos = [cat20Utxo]
    const tracableNfts = await CAT721Covenant.backtrace(
        inputCAT721Utxos.map((utxo) => {
            return { ...utxo, minterAddr: cat721Covenant.minterAddr }
        }),
        chainProvider
    )
    const tracableTokens = await CAT20Covenant.backtrace(
        inputCAT20Utxos.map((utxo) => {
            return { ...utxo, minterAddr: cat20Covenant.minterAddr }
        }),
        chainProvider
    )
    const inputNft = tracableNfts[0].nft
    const inputToken = tracableTokens[0].token
    const utxos = await utxoProvider.getUtxos(changeAddress)
    const { estSplitFeeTxVSize } = estimatedSplitFeeVSize(
        utxos,
        address,
        feeRate,
        serviceFee
    )

    const splitFeePsbt = buildSplitFeeTx(
        utxos,
        address,
        feeRate,
        serviceFee,
        estSplitFeeTxVSize
    )
    const deployCAT721GuardUtxo = splitFeePsbt.getUtxo(1)
    const deployCAT20GuardUtxo = splitFeePsbt.getUtxo(2)
    const lockToMintUtxo = splitFeePsbt.getUtxo(3)
    const { guard, outputNfts } = CAT721Covenant.createTransferGuard(
        [inputNft].map((nft, i) => ({
            nft,
            inputIndex: i,
        })),
        [
            {
                address: toTokenAddress(nftReceiver),
                outputIndex: 1,
            },
        ]
    )
    const lockToMint = lockToMintCovenant.getSubContract() as LockToMint
    const _isP2TR = isP2TR(address)
    const _pubKeyPrefix = _isP2TR ? '' : pubKeyPrefix(pubkey)
    const _pubkeyX = toXOnly(pubkey, _isP2TR)
    const timeLockScriptHex = LockToMint.buildCatTimeLockP2wsh(
        _pubKeyPrefix + _pubkeyX,
        lockToMint.nonce,
        lockToMint.lockedBlocks
    )
    const receivers: {
        address: Ripemd160
        amount: bigint
        outputIndex: number
    }[] = [
        {
            address: hash160(timeLockScriptHex),
            amount: lockToMint.lockTokenAmount,
            outputIndex: 2,
        },
    ]
    let cat20Change = 0n
    if (inputToken.state.amount > lockToMint.lockTokenAmount) {
        cat20Change = inputToken.state.amount - lockToMint.lockTokenAmount
        receivers.push({
            address: Ripemd160(inputToken.state.ownerAddr),
            amount: cat20Change,
            outputIndex: 3,
        })
    }
    const { guard: guardCAT20, outputTokens } =
        CAT20Covenant.createTransferGuard(
            [inputToken].map((token, i) => ({ token, inputIndex: i + 1 })),
            receivers
        )
    const guardCAT721Psbt = buildCAT721GuardTx(guard, [deployCAT721GuardUtxo])
    const guardCAT20Psbt = buildCAT20GuardTx(guardCAT20, lockToMintCovenant, [
        deployCAT20GuardUtxo,
    ])
    const lockToMintPsbt = buildLockToMintTx(
        tracableNfts,
        tracableTokens,
        cat20Change,
        guard,
        guardCAT20,
        lockToMintCovenant,
        lockToMintUtxo,
        guardCAT721Psbt,
        guardCAT20Psbt,
        pubkey,
        outputNfts,
        outputTokens,
        timeLockScriptHex,
        serviceFee,
        serviceFeeAddress,
        changeAddress
    )

    // sign the psbts
    const [
        signedSplitFeePsbt,
        signedGuardCAT721Psbt,
        signedGuardCAT20Psbt,
        signedLockToMintPsbt,
    ] = await signer.signPsbts([
        {
            psbtHex: splitFeePsbt.toHex(),
            options: splitFeePsbt.psbtOptions(),
        },
        {
            psbtHex: guardCAT721Psbt.toHex(),
            options: guardCAT721Psbt.psbtOptions(),
        },
        {
            psbtHex: guardCAT20Psbt.toHex(),
            options: guardCAT20Psbt.psbtOptions(),
        },
        {
            psbtHex: lockToMintPsbt.toHex(),
            options: lockToMintPsbt.psbtOptions(),
        },
    ])

    // combine and finalize the psbts
    const splitFeeTx = await splitFeePsbt
        .combine(bitcoinjs.Psbt.fromHex(signedSplitFeePsbt))
        .finalizeAllInputsAsync()
    const guardCAT721Tx = await guardCAT721Psbt
        .combine(bitcoinjs.Psbt.fromHex(signedGuardCAT721Psbt))
        .finalizeAllInputsAsync()
    const guardCAT20Tx = await guardCAT20Psbt
        .combine(bitcoinjs.Psbt.fromHex(signedGuardCAT20Psbt))
        .finalizeAllInputsAsync()
    const lockToMintTx = await lockToMintPsbt
        .combine(bitcoinjs.Psbt.fromHex(signedLockToMintPsbt))
        .finalizeAllInputsAsync()
    // broadcast the transactions
    await chainProvider.broadcast(splitFeeTx.extractTransaction().toHex())
    await chainProvider.broadcast(guardCAT721Tx.extractTransaction().toHex())
    await chainProvider.broadcast(guardCAT20Tx.extractTransaction().toHex())
    await chainProvider.broadcast(lockToMintTx.extractTransaction().toHex())
    return { splitFeeTx, guardCAT721Tx, guardCAT20Tx, lockToMintTx }
}

export const CAT721_GUARD_DEPLOY_TX_VSIZE = 146
export const CAT20_GUARD_DEPLOY_TX_VSIZE = 189
export const CLAIM_TX_VSIZE = 6300

function buildSplitFeeTx(
    feeUtxos: UTXO[],
    address: string,
    feeRate: number,
    serviceFee: number,
    estimatedVSize?: number
) {
    const splitFeeTx = new CatPsbt()
        .addFeeInputs(feeUtxos)
        .addOutput({
            value: BigInt(CAT721_GUARD_DEPLOY_TX_VSIZE * feeRate + 330),
            address: address,
        })
        .addOutput({
            value: BigInt(CAT20_GUARD_DEPLOY_TX_VSIZE * feeRate + 330 * 2),
            address: address,
        })
        .addOutput({
            value: BigInt(CLAIM_TX_VSIZE * feeRate + serviceFee),
            address: address,
        })
        .change(address, feeRate, estimatedVSize)
    return splitFeeTx
}

function estimatedSplitFeeVSize(
    feeUtxos: UTXO[],
    address: string,
    feeRate: number,
    serviceFee: number
) {
    const dummySplitFeePsbt = buildSplitFeeTx(
        feeUtxos,
        address,
        feeRate,
        serviceFee,
        DUST_LIMIT
    )
    return {
        dummySplitFeePsbt,
        estSplitFeeTxVSize: dummySplitFeePsbt.estimateVSize(),
    }
}

function buildCAT721GuardTx(guard: CAT721GuardCovenant, feeUtxos: UTXO[]) {
    const guardTx = new CatPsbt()
        .addFeeInputs(feeUtxos)
        .addCovenantOutput(guard, Postage.GUARD_POSTAGE)
    guard.bindToUtxo(guardTx.getUtxo(1))
    return guardTx
}

function buildCAT20GuardTx(
    guard: Cat20GuardCovenant,
    lockToMint: LockToMintCovenant,
    feeUtxos: UTXO[]
) {
    const guardTx = new CatPsbt()
        .addFeeInputs(feeUtxos)
        .addCovenantOutput(guard, Postage.GUARD_POSTAGE)
        .addCovenantOutput(lockToMint, Postage.TOKEN_POSTAGE)
    guard.bindToUtxo(guardTx.getUtxo(1))
    lockToMint.bindToUtxo(guardTx.getUtxo(2))
    return guardTx
}

function buildLockToMintTx(
    tracableNfts: TracedCat721Nft[],
    tracableTokens: TracedCat20Token[],
    cat20Change: int32,
    guard: CAT721GuardCovenant,
    guardCAT20: Cat20GuardCovenant,
    lockToMintCovenant: LockToMintCovenant,
    feeUtxo: UTXO,
    guardPsbt: CatPsbt,
    guardCAT20Psbt: CatPsbt,
    pubKey: string,
    outputNfts: (CAT721Covenant | undefined)[],
    outputTokens: (CAT20Covenant | undefined)[],
    timeLockScriptHex: string,
    serviceFee: number,
    serviceFeeAddress: string,
    changeAddress: string
) {
    const inputNfts = tracableNfts.map((nft) => nft.nft)
    const inputTokens = tracableTokens.map((token) => token.token)
    const lockToMintTx = new CatPsbt()
    // add nft inputs
    for (const inputNft of inputNfts) {
        lockToMintTx.addCovenantInput(inputNft)
    }
    // add token inputs
    for (const inputToken of inputTokens) {
        lockToMintTx.addCovenantInput(inputToken)
    }
    // add nft guard
    lockToMintTx.addCovenantInput(guard, GuardType.Transfer)
    // add token guard
    lockToMintTx.addCovenantInput(guardCAT20, GuardType.Transfer)
    // add lockToMint
    lockToMintTx.addCovenantInput(lockToMintCovenant)
    // add fee
    lockToMintTx.addFeeInputs([feeUtxo])

    // add nft outputs
    for (const outputNft of outputNfts) {
        if (outputNft) {
            lockToMintTx.addCovenantOutput(outputNft, Postage.TOKEN_POSTAGE)
        }
    }
    // add token outputs
    for (const outputToken of outputTokens) {
        if (outputToken) {
            lockToMintTx.addCovenantOutput(outputToken, Postage.TOKEN_POSTAGE)
        }
    }
    // add timelock
    lockToMintTx.addOutput({
        script: hexToUint8Array(timeLockScriptHex),
        value: BigInt(Postage.TOKEN_POSTAGE),
    })
    lockToMintTx.addOutput({
        address: serviceFeeAddress,
        value: BigInt(serviceFee),
    })
    const serviceOutputIndex = lockToMintTx.txOutputs.length - 1
    const serviceFeeInfo: ChangeInfo = {
        script: uint8ArrayToHex(
            lockToMintTx.txOutputs[serviceOutputIndex].script
        ),
        satoshis: int2ByteString(BigInt(serviceFee), 8n),
    }

    const inputCtxs = lockToMintTx.calculateInputCtxs()
    const guardInputIndex = 2
    const guardCAT20InputIndex = 3
    const lockToMintInputIndex = 4
    // unlock nfts
    for (let i = 0; i < inputNfts.length; i++) {
        lockToMintTx.updateCovenantInput(
            i,
            inputNfts[i],
            inputNfts[i].contractSpend(
                i,
                inputCtxs,
                tracableNfts[i].trace,
                guard.getGuardInfo(guardInputIndex, guardPsbt.toTxHex()),
                4
            )
        )
    }
    for (let i = 0; i < inputTokens.length; i++) {
        lockToMintTx.updateCovenantInput(
            i + 1,
            inputTokens[i],
            inputTokens[i].userSpend(
                i + 1,
                inputCtxs,
                tracableTokens[i].trace,
                guardCAT20.getGuardInfo(
                    guardCAT20InputIndex,
                    guardCAT20Psbt.toTxHex()
                ),
                isP2TR(changeAddress),
                pubKey
            )
        )
    }
    // unlock guard
    lockToMintTx.updateCovenantInput(
        guardInputIndex,
        guard,
        guard.transfer(
            guardInputIndex,
            inputCtxs,
            outputNfts,
            guardPsbt.toTxHex()
        )
    )
    // unlock guardCAT20
    lockToMintTx.updateCovenantInput(
        guardCAT20InputIndex,
        guardCAT20,
        guardCAT20.transfer(
            guardCAT20InputIndex,
            inputCtxs,
            outputTokens,
            guardCAT20Psbt.toTxHex()
        )
    )
    const trace = tracableTokens[0].trace
    const prevTx = new btc.Transaction(trace.prevTxHex)
    const txHeader = txToTxHeader(prevTx.toBuffer(true))
    const txHeaderTiny = txToTxHeaderTiny(txHeader)
    // unlock lockToMint
    const preCAT20TxState: PreTxStatesInfo = {
        statesHashRoot: trace.prevTxState.hashRoot,
        txoStateHashes: trace.prevTxState.stateHashList,
    }
    lockToMintTx.updateCovenantInput(
        lockToMintInputIndex,
        lockToMintCovenant,
        lockToMintCovenant.claimNft(
            lockToMintInputIndex,
            inputCtxs,
            outputNfts[0].state!,
            txHeaderTiny,
            BigInt(inputTokens[0].utxo.outputIndex),
            int2ByteString(BigInt(inputTokens[0].utxo.outputIndex), 4n),
            inputTokens[0].state,
            preCAT20TxState,
            {
                isP2TR: isP2TR(changeAddress),
                pubKey: pubKey,
            },
            cat20Change,
            serviceFeeInfo
        )
    )
    return lockToMintTx
}
